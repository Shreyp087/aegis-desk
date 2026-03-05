import {
  Factor,
  QueueAction,
  RiskDecision,
  SessionEvent,
  SessionState,
  StepUpLevel,
  StepUpMethod,
} from "./types";
import { policyForMode } from "./policy";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function nowMs() {
  return Date.now();
}

function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
}

function seqHash(actions: QueueAction[]) {
  return actions.join("|");
}

function timingUniformityScore01(events: SessionEvent[]) {
  if (events.length < 5) return 0;

  const recent = events.slice(-8);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    intervals.push(recent[i].ts - recent[i - 1].ts);
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return 0;

  const variance =
    intervals.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / intervals.length;
  const std = Math.sqrt(variance);
  const cv = std / mean;
  const score = (0.18 - cv) / 0.18;
  return clamp01(score);
}

function velocityScore01(events: SessionEvent[]) {
  const t = nowMs();
  const windowMs = 2500;
  const recent = events.filter((e) => t - e.ts <= windowMs);
  const perSec = recent.length / (windowMs / 1000);
  return clamp01((perSec - 2) / 4);
}

function challengeFailRate01(state: SessionState) {
  const total = state.failedChallenges + state.passedChallenges;
  if (total < 3) return 0;
  const rate = state.failedChallenges / total;
  return clamp01((rate - 0.15) / 0.6);
}

function navAnomaly01(state: SessionState, attempted: QueueAction) {
  if (attempted === "CHECKOUT" && !state.joined) return 1;
  return 0;
}

function replay01(state: SessionState) {
  if (state.events.length < 6) return 0;
  const last = state.events.slice(-5).map((e) => e.action);
  const h = seqHash(last);
  const count = state.seenSequenceHashes[h] || 0;
  if (count >= 2) return 1;
  if (count === 1) return 0.65;
  return 0;
}

function metaFlag01(events: SessionEvent[], key: "multiTab" | "tokenReuse" | "uaFlip") {
  const recent = events.slice(-10);
  const flagged = recent.some((e) => e.meta?.[key]);
  return flagged ? 1 : 0;
}

function buildFactor(
  key: string,
  label: string,
  weight: number,
  score01: number,
  evidence: string
): Factor {
  const s = clamp01(score01);
  return {
    key,
    label,
    weight,
    score01: s,
    points: weight * s,
    evidence,
  };
}

function computeRisk(state: SessionState, attempted: QueueAction): { risk: number; factors: Factor[]; notes: string[] } {
  const policy = policyForMode(state.mode);

  const v01 = velocityScore01(state.events);
  const t01 = timingUniformityScore01(state.events);
  const r01 = replay01(state);
  const n01 = navAnomaly01(state, attempted);
  const mt01 = metaFlag01(state.events, "multiTab");
  const tr01 = metaFlag01(state.events, "tokenReuse");
  const ua01 = metaFlag01(state.events, "uaFlip");
  const cf01 = challengeFailRate01(state);

  const w = policy.weights;

  const factors: Factor[] = [
    buildFactor("velocity", "Velocity anomaly", w.velocity, v01, "High actions/sec in a short window"),
    buildFactor("timing", "Timing uniformity", w.timingUniformity, t01, "Intervals too consistent (robotic)"),
    buildFactor("replay", "Replay pattern", w.replay, r01, "Repeated recent action sequence"),
    buildFactor("nav", "Navigation anomaly", w.navAnomaly, n01, "Impossible flow (e.g., checkout without join)"),
    buildFactor("multiTab", "Multi-tab burst", w.multiTab, mt01, "Simulated multi-tab behavior detected"),
    buildFactor("tokenReuse", "Token reuse", w.tokenReuse, tr01, "Simulated token/session reuse detected"),
    buildFactor("uaFlip", "User-agent flip", w.uaFlip, ua01, "Simulated UA/device flip detected"),
    buildFactor("challengeFail", "Challenge failure rate", w.challengeFailRate, cf01, "Repeated failure suggests automation"),
  ];

  const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0) || 1;
  const totalPoints = factors.reduce((acc, f) => acc + f.points, 0);
  const normalized01 = totalPoints / totalWeight;
  const risk = Math.round(clamp(normalized01 * 100, 0, 100));

  const notes: string[] = [];
  if (state.mode === "ACCESSIBILITY_FIRST") notes.push("Accessibility-first policy active: prefer minimal friction and clear alternatives.");
  if (state.mode === "FAN_FIRST") notes.push("Fan-first policy active: keep low-risk users frictionless, step-up only on clear risk.");
  if (state.mode === "STRICT") notes.push("Strict policy active: aggressive step-up against suspected automation.");

  return { risk, factors: factors.sort((a, b) => b.points - a.points), notes };
}

function decideAction(state: SessionState, risk: number): { action: RiskDecision["action"]; stepUpLevel: StepUpLevel; stepUpMethod: StepUpMethod } {
  const policy = policyForMode(state.mode);

  if (risk < policy.stepUpL1Threshold) return { action: "ALLOW", stepUpLevel: 0, stepUpMethod: "NONE" };
  if (risk < policy.stepUpL2Threshold) return { action: "STEP_UP", stepUpLevel: 1, stepUpMethod: "HOLD_TO_CONFIRM" };
  if (risk >= policy.blockThreshold) return { action: "BLOCK", stepUpLevel: 2, stepUpMethod: "OTP" };
  if (risk >= policy.throttleThreshold) return { action: "THROTTLE", stepUpLevel: 2, stepUpMethod: "OTP" };
  return { action: "STEP_UP", stepUpLevel: 2, stepUpMethod: "OTP" };
}

export function initSessionState(partial?: Partial<SessionState>): SessionState {
  return {
    sessionId: partial?.sessionId ?? "sess-" + uuid(),
    policyVersion: partial?.policyVersion ?? "qg-1.0",
    mode: partial?.mode ?? "FAN_FIRST",
    joined: false,
    frictionUsed: 0,
    frictionCap: 100,
    events: [],
    seenSequenceHashes: {},
    failedChallenges: 0,
    passedChallenges: 0,
  };
}

export function recordEvent(state: SessionState, action: QueueAction, meta?: SessionEvent["meta"]): SessionState {
  const event: SessionEvent = { id: uuid(), ts: nowMs(), action, meta };

  const next: SessionState = {
    ...state,
    events: [...state.events, event].slice(-200),
  };

  if (action === "JOIN") next.joined = true;

  if (next.events.length >= 5) {
    const last = next.events.slice(-5).map((e) => e.action);
    const h = seqHash(last);
    next.seenSequenceHashes = {
      ...next.seenSequenceHashes,
      [h]: (next.seenSequenceHashes[h] || 0) + 1,
    };
  }

  return next;
}

export function evaluateAttempt(state: SessionState, attempted: QueueAction): RiskDecision {
  const t0 = nowMs();
  const policy = policyForMode(state.mode);
  const frictionCap = policy.frictionCap;
  const frictionUsed = state.frictionUsed;

  const { risk, factors, notes } = computeRisk(state, attempted);
  const { action, stepUpLevel, stepUpMethod } = decideAction(state, risk);
  const latencyMs = Math.max(1, nowMs() - t0);

  const friction = {
    cap: frictionCap,
    used: frictionUsed,
    remaining: Math.max(0, frictionCap - frictionUsed),
  };

  return {
    risk,
    action,
    stepUpLevel,
    stepUpMethod,
    factors,
    latencyMs,
    notes,
    friction,
  };
}

export function applyStepUpResult(
  state: SessionState,
  stepUpLevel: StepUpLevel,
  passed: boolean
): SessionState {
  const policy = policyForMode(state.mode);

  let frictionSpend = 0;
  if (passed) {
    frictionSpend = stepUpLevel === 1 ? policy.frictionCostL1 : stepUpLevel === 2 ? policy.frictionCostL2 : 0;
  } else {
    frictionSpend = stepUpLevel === 1 ? Math.floor(policy.frictionCostL1 / 2) : stepUpLevel === 2 ? Math.floor(policy.frictionCostL2 / 2) : 0;
  }

  const next: SessionState = { ...state };
  next.frictionCap = policy.frictionCap;
  next.frictionUsed = clamp(next.frictionUsed + frictionSpend, 0, policy.frictionCap + 50);

  if (passed) next.passedChallenges += 1;
  else next.failedChallenges += 1;

  return next;
}
