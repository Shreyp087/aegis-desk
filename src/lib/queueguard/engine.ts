import { QUEUEGUARD_POLICY } from "./policy";
import {
  applyChallengeFailure,
  applyChallengeSuccess,
  consumeFriction,
  getFrictionBudget,
  issueChallenge,
  recordAction,
  registerChallengeAttempt,
} from "./store";
import { sha256Hex } from "./hash";
import type {
  QueueDecision,
  QueueEventType,
  QueueSessionState,
  QueueSignalSnapshot,
  QueueVerifyInput,
  RiskFactor,
  StepUpChallenge,
  StepUpLevel,
} from "./types";

const HOLD_LEVEL_1_MS = 2000;
const HOLD_LEVEL_2_FALLBACK_MS = 3000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = average(values);
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function derivePayloadHash(snapshot: QueueSignalSnapshot, eventType: QueueEventType): string {
  if (snapshot.payloadHash && snapshot.payloadHash.trim().length > 0) {
    return snapshot.payloadHash.trim();
  }
  return sha256Hex(`${eventType}|${Math.floor(Date.now() / 5000)}`);
}

function deriveSequenceFingerprint(snapshot: QueueSignalSnapshot, eventType: QueueEventType): string {
  if (snapshot.sequenceFingerprint && snapshot.sequenceFingerprint.trim().length > 0) {
    return snapshot.sequenceFingerprint.trim();
  }
  return eventType;
}

function computeFactors(args: {
  session: QueueSessionState;
  nowMs: number;
  eventType: QueueEventType;
  snapshot: QueueSignalSnapshot;
  payloadHash: string;
  sequenceFingerprint: string;
}): RiskFactor[] {
  const { session, nowMs, eventType, snapshot, payloadHash, sequenceFingerprint } = args;
  const weights = QUEUEGUARD_POLICY.signalWeights;

  const recentCount = session.history.filter((entry) => nowMs - entry.ts <= 10_000).length + 1;
  const actionsPerSecond = recentCount / 10;
  const velocityScore = clamp01((actionsPerSecond - 0.8) / 3.2);

  const derivedIntervals = session.history
    .slice(-8)
    .map((entry, idx, arr) => (idx === 0 ? 0 : entry.ts - arr[idx - 1].ts))
    .filter((v) => v > 0);
  if (snapshot.timingIntervalMs && snapshot.timingIntervalMs > 0) {
    derivedIntervals.push(snapshot.timingIntervalMs);
  }
  const cv =
    derivedIntervals.length >= 3
      ? stdDev(derivedIntervals) / Math.max(1, average(derivedIntervals))
      : 0.18;
  const timingEntropyScore = clamp01((0.25 - cv) / 0.25);

  const payloadRepeats = session.payloadCounts[payloadHash] || 0;
  const sequenceRepeats = session.sequenceCounts[sequenceFingerprint] || 0;
  const replayScore = Math.max(
    clamp01(payloadRepeats / 3),
    clamp01(sequenceRepeats / 4)
  );

  const hasSeenJoin = session.history.some((entry) => entry.eventType === "join_queue");
  const hasRecentJoin = session.history.some(
    (entry) => entry.eventType === "join_queue" && nowMs - entry.ts <= 600_000
  );
  const refreshWithoutJoinCount = session.history.filter(
    (entry) => entry.eventType === "refresh" && !hasSeenJoin
  ).length;
  let navigationScore = 0;
  if (eventType === "checkout" && !hasSeenJoin) navigationScore = 1;
  else if (eventType === "checkout" && !hasRecentJoin) navigationScore = 0.72;
  else if (eventType === "refresh" && !hasSeenJoin && refreshWithoutJoinCount >= 4) navigationScore = 0.55;

  const multiTabScore = snapshot.multiTabBurst ? 1 : 0;
  const sessionIntegrityScore = clamp01(
    (snapshot.tokenReuse ? 0.65 : 0) + (snapshot.uaFlip ? 0.55 : 0)
  );

  const challengeFailureRate =
    session.challengeAttempts > 0
      ? session.challengeFailures / session.challengeAttempts
      : 0;
  const challengeFailureScore = clamp01(challengeFailureRate * 1.4);

  const factors: RiskFactor[] = [
    {
      key: "velocity",
      label: "Velocity Anomaly",
      weight: weights.velocity,
      score: Number(velocityScore.toFixed(3)),
      contribution: Number((velocityScore * weights.velocity).toFixed(2)),
      evidence: `${actionsPerSecond.toFixed(2)} actions/sec over last 10s`,
    },
    {
      key: "timing_entropy",
      label: "Timing Entropy",
      weight: weights.timing_entropy,
      score: Number(timingEntropyScore.toFixed(3)),
      contribution: Number((timingEntropyScore * weights.timing_entropy).toFixed(2)),
      evidence:
        derivedIntervals.length < 3
          ? "Limited interval history; conservative score applied."
          : `Coefficient of variation=${cv.toFixed(3)} from ${derivedIntervals.length} intervals`,
    },
    {
      key: "replay",
      label: "Replay Pattern",
      weight: weights.replay,
      score: Number(replayScore.toFixed(3)),
      contribution: Number((replayScore * weights.replay).toFixed(2)),
      evidence: `Payload repeats=${payloadRepeats}, sequence repeats=${sequenceRepeats}`,
    },
    {
      key: "navigation",
      label: "Navigation Anomaly",
      weight: weights.navigation,
      score: Number(navigationScore.toFixed(3)),
      contribution: Number((navigationScore * weights.navigation).toFixed(2)),
      evidence:
        eventType === "checkout" && !hasSeenJoin
          ? "Checkout attempted before queue join."
          : eventType === "checkout" && !hasRecentJoin
            ? "Checkout attempted without recent queue join."
            : eventType === "refresh" && !hasSeenJoin
              ? "Repeated refresh without joining queue."
              : "Flow appears plausible.",
    },
    {
      key: "multi_tab_burst",
      label: "Multi-Tab Burst",
      weight: weights.multi_tab_burst,
      score: Number(multiTabScore.toFixed(3)),
      contribution: Number((multiTabScore * weights.multi_tab_burst).toFixed(2)),
      evidence: snapshot.multiTabBurst
        ? "Concurrent tab burst signal detected."
        : "No multi-tab burst indicator.",
    },
    {
      key: "session_integrity",
      label: "Session Integrity",
      weight: weights.session_integrity,
      score: Number(sessionIntegrityScore.toFixed(3)),
      contribution: Number((sessionIntegrityScore * weights.session_integrity).toFixed(2)),
      evidence: `tokenReuse=${Boolean(snapshot.tokenReuse)}, uaFlip=${Boolean(snapshot.uaFlip)}`,
    },
    {
      key: "challenge_failure_rate",
      label: "Challenge Failure Rate",
      weight: weights.challenge_failure_rate,
      score: Number(challengeFailureScore.toFixed(3)),
      contribution: Number((challengeFailureScore * weights.challenge_failure_rate).toFixed(2)),
      evidence:
        session.challengeAttempts > 0
          ? `${session.challengeFailures}/${session.challengeAttempts} failed challenge attempts`
          : "No challenge failures recorded",
    },
  ];

  return factors;
}

function computeRiskScore(session: QueueSessionState, factors: RiskFactor[], nowMs: number): number {
  const base = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const trustReduction = session.trustedUntil && session.trustedUntil > nowMs ? 12 : 0;
  return Math.round(clamp(base - trustReduction, 0, 100));
}

function computeStepUpLevel(risk: number, budgetRemaining: number): StepUpLevel {
  let desiredLevel: StepUpLevel = 0;
  if (risk >= QUEUEGUARD_POLICY.thresholds.throttle) desiredLevel = 2;
  else if (risk >= QUEUEGUARD_POLICY.thresholds.stepUp) desiredLevel = 1;

  if (desiredLevel === 0) return 0;
  if (desiredLevel === 2 && budgetRemaining >= QUEUEGUARD_POLICY.challengeCost[2]) return 2;
  if (budgetRemaining >= QUEUEGUARD_POLICY.challengeCost[1]) return 1;
  return 0;
}

function deriveAction(risk: number, stepUpLevel: StepUpLevel): QueueDecision["action"] {
  if (risk >= QUEUEGUARD_POLICY.thresholds.block) return "BLOCK";
  if (risk >= QUEUEGUARD_POLICY.thresholds.throttle) {
    return stepUpLevel > 0 ? "THROTTLE" : "THROTTLE";
  }
  if (risk >= QUEUEGUARD_POLICY.thresholds.stepUp) {
    return stepUpLevel > 0 ? "STEP_UP" : "ALLOW";
  }
  return "ALLOW";
}

function buildDecision(args: {
  risk: number;
  factors: RiskFactor[];
  action: QueueDecision["action"];
  stepUpLevel: StepUpLevel;
  session: QueueSessionState;
}): QueueDecision {
  return {
    risk: args.risk,
    factors: args.factors,
    topFactors: [...args.factors].sort((a, b) => b.contribution - a.contribution).slice(0, 3),
    action: args.action,
    stepUpLevel: args.stepUpLevel,
    frictionBudget: getFrictionBudget(args.session),
    policyVersion: QUEUEGUARD_POLICY.version,
  };
}

export function evaluateQueueAction(args: {
  session: QueueSessionState;
  eventType: QueueEventType;
  snapshot: QueueSignalSnapshot;
}): { decision: QueueDecision; challenge?: StepUpChallenge } {
  const nowMs = Date.now();
  const payloadHash = derivePayloadHash(args.snapshot, args.eventType);
  const sequenceFingerprint = deriveSequenceFingerprint(args.snapshot, args.eventType);

  const factors = computeFactors({
    session: args.session,
    nowMs,
    eventType: args.eventType,
    snapshot: args.snapshot,
    payloadHash,
    sequenceFingerprint,
  });
  const risk = computeRiskScore(args.session, factors, nowMs);
  const budgetBefore = getFrictionBudget(args.session);
  const stepUpLevel = computeStepUpLevel(risk, budgetBefore.remaining);
  const action = deriveAction(risk, stepUpLevel);

  if (stepUpLevel === 1 || stepUpLevel === 2) {
    consumeFriction(args.session, stepUpLevel);
  }

  recordAction(args.session, args.eventType, payloadHash, sequenceFingerprint, nowMs);

  const decision = buildDecision({
    risk,
    factors,
    action,
    stepUpLevel,
    session: args.session,
  });
  args.session.lastDecision = decision;
  args.session.lastEventType = args.eventType;

  if (stepUpLevel === 1 || stepUpLevel === 2) {
    const challenge = issueChallenge(args.session, stepUpLevel);
    return { decision, challenge };
  }
  args.session.pendingChallenge = undefined;
  return { decision };
}

function decisionFromLast(session: QueueSessionState, args: {
  riskOverride?: number;
  actionOverride?: QueueDecision["action"];
  stepUpLevelOverride?: StepUpLevel;
}): QueueDecision {
  const previous = session.lastDecision;
  const factors = previous?.factors || [];
  const risk = args.riskOverride ?? previous?.risk ?? 25;
  const stepUpLevel = args.stepUpLevelOverride ?? previous?.stepUpLevel ?? 0;
  const action = args.actionOverride ?? previous?.action ?? "ALLOW";
  return buildDecision({
    risk,
    factors,
    action,
    stepUpLevel,
    session,
  });
}

export function verifyStepUpChallenge(args: {
  session: QueueSessionState;
  input: QueueVerifyInput;
}): { verified: boolean; decision: QueueDecision; challenge?: StepUpChallenge; reason: string } {
  const { session, input } = args;
  const pending = session.pendingChallenge;
  registerChallengeAttempt(session);

  if (!pending) {
    return {
      verified: false,
      decision: decisionFromLast(session, { riskOverride: 35, actionOverride: "ALLOW", stepUpLevelOverride: 0 }),
      reason: "No active challenge for this session.",
    };
  }
  if (pending.challengeId !== input.challengeId) {
    applyChallengeFailure(session);
    return {
      verified: false,
      decision: decisionFromLast(session, {
        riskOverride: clamp((session.lastDecision?.risk ?? 55) + 8, 0, 100),
        actionOverride: "THROTTLE",
        stepUpLevelOverride: pending.level,
      }),
      reason: "Challenge ID mismatch.",
      challenge:
        pending.level === 1
          ? { challengeId: pending.challengeId, level: 1, kind: "hold", holdDurationMs: HOLD_LEVEL_1_MS }
          : {
              challengeId: pending.challengeId,
              level: 2,
              kind: "otp",
              otpForDemo: pending.otpCode,
              expiresAt: pending.expiresAt ? new Date(pending.expiresAt).toISOString() : undefined,
            },
    };
  }

  const nowMs = Date.now();
  let passed = false;
  let reason = "";

  if (pending.level === 1) {
    if (input.method === "hold" && (input.holdDurationMs || 0) >= HOLD_LEVEL_1_MS) {
      passed = true;
    } else {
      reason = "Hold-to-confirm did not reach required duration.";
    }
  } else {
    const otpExpired = Boolean(pending.expiresAt && pending.expiresAt < nowMs);
    if (otpExpired) {
      reason = "OTP expired. Re-issue challenge.";
      const reissued = issueChallenge(session, 2);
      return {
        verified: false,
        decision: decisionFromLast(session, {
          riskOverride: clamp((session.lastDecision?.risk ?? 60) + 6, 0, 100),
          actionOverride: "THROTTLE",
          stepUpLevelOverride: 2,
        }),
        challenge: reissued,
        reason,
      };
    }

    if (input.method === "otp" && input.otp && input.otp === pending.otpCode) {
      passed = true;
    } else if (input.method === "hold" && (input.holdDurationMs || 0) >= HOLD_LEVEL_2_FALLBACK_MS) {
      passed = true;
      reason = "Accessible hold fallback accepted for level-2 challenge.";
    } else {
      reason = "OTP invalid (or fallback hold too short).";
    }
  }

  if (passed) {
    applyChallengeSuccess(session);
    const decision = decisionFromLast(session, {
      riskOverride: clamp((session.lastDecision?.risk ?? 35) - 28, 0, 100),
      actionOverride: "ALLOW",
      stepUpLevelOverride: 0,
    });
    session.lastDecision = decision;
    return {
      verified: true,
      decision,
      reason: reason || "Challenge passed.",
    };
  }

  applyChallengeFailure(session);
  const failRisk = clamp((session.lastDecision?.risk ?? 60) + 10 + session.challengeFailures * 6, 0, 100);
  const failAction: QueueDecision["action"] =
    failRisk >= QUEUEGUARD_POLICY.thresholds.block ? "BLOCK" : "THROTTLE";
  const decision = decisionFromLast(session, {
    riskOverride: failRisk,
    actionOverride: failAction,
    stepUpLevelOverride: pending.level,
  });
  session.lastDecision = decision;

  return {
    verified: false,
    decision,
    challenge:
      pending.level === 1
        ? { challengeId: pending.challengeId, level: 1, kind: "hold", holdDurationMs: HOLD_LEVEL_1_MS }
        : {
            challengeId: pending.challengeId,
            level: 2,
            kind: "otp",
            otpForDemo: pending.otpCode,
            expiresAt: pending.expiresAt ? new Date(pending.expiresAt).toISOString() : undefined,
          },
    reason: reason || "Challenge failed.",
  };
}
