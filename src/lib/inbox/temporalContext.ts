import {
  computeGapsHours,
  getClusterRecords,
  getSenderRecords,
  getThreadRecords,
  median,
} from "./sessionStore";
import type {
  ConvergingSignalSignal,
  SilenceBreakSignal,
  TemporalContextInput,
  TemporalContextResult,
  UnresolvedThreadSignal,
} from "./temporalContext.types";

/**
 * Clamps a number into an inclusive range.
 *
 * Pipeline step: shared helper for the synchronous temporal detectors before any score delta is returned.
 * False-positive scenario addressed: prevents any one temporal adjustment from overwhelming the base inbox scoring stack.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Builds the default zero-impact silence-break payload.
 *
 * Pipeline step: returned whenever cadence evidence is too weak to justify temporal urgency amplification.
 * False-positive scenario addressed: sparse sender activity should never manufacture urgency on its own.
 */
function defaultSilenceBreakSignal(): SilenceBreakSignal {
  return {
    detected: false,
    gapHours: 0,
    expectedGapHours: 0,
    deviationFactor: 0,
    urgencyBoost: 0,
    confidence: 0,
    rationale: "No meaningful silence break detected.",
  };
}

/**
 * Builds the default zero-impact unresolved-thread payload.
 *
 * Pipeline step: returned whenever no earlier scored thread record is eligible to carry urgency forward.
 * False-positive scenario addressed: first-touch and previously suppressed threads stay suppressed.
 */
function defaultUnresolvedThreadSignal(threadKeyHash: string): UnresolvedThreadSignal {
  return {
    detected: false,
    threadKeyHash,
    priorScoredCount: 0,
    hoursApart: 0,
    priorMaxBand: null,
    priorMaxAction: null,
    urgencyBoost: 0,
    routingOverride: null,
    rationale: "No unresolved thread follow-up detected.",
  };
}

/**
 * Builds the default zero-impact converging-signal payload.
 *
 * Pipeline step: returned when cross-domain cluster evidence is too weak or too generic to matter.
 * False-positive scenario addressed: prevents isolated medium-value messages from being misread as campaigns.
 */
function defaultConvergingSignalSignal(
  clusterKey: TemporalContextInput["clusterKey"]
): ConvergingSignalSignal {
  return {
    detected: false,
    clusterKey,
    distinctDomains: 0,
    signalStrength: 0,
    urgencyBoost: 0,
    threatElevation: 0,
    campaignType: "ambiguous",
    rationale: "No converging signal pattern detected.",
  };
}

/**
 * Maps a priority band to a sortable rank.
 *
 * Pipeline step: unresolved-thread detection uses this to preserve the strongest prior thread band in its output.
 * False-positive scenario addressed: ensures high-priority prior thread state outranks medium and low when summarizing thread pressure.
 */
function bandRank(value: "high" | "medium" | "low" | null): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

/**
 * Detects whether the current email breaks the sender's cadence pattern, first within the batch and then via the trust-graph bridge.
 *
 * Pipeline step: runs after scoreEmail() and before the FP Guard so temporal silence can amplify urgency without any new persistence.
 * False-positive scenario addressed: promotional senders and low-confidence cadence estimates are filtered out before any boost is applied.
 */
function detectSilenceBreak(input: TemporalContextInput): SilenceBreakSignal {
  const empty = defaultSilenceBreakSignal();
  const senderRecords = getSenderRecords(input.store, input.senderDomainHash);

  if (
    input.trustGraph.seen < 4 ||
    input.decisionProfile.primaryCategory === "newsletter" ||
    input.decisionProfile.primaryCategory === "sales_marketing"
  ) {
    return empty;
  }

  if (senderRecords.length >= 3) {
    const currentIndex = senderRecords.findIndex(
      (record) =>
        record.receivedAt === input.receivedAt && record.threadKeyHash === input.threadKeyHash
    );
    if (currentIndex <= 0) {
      return empty;
    }

    const gaps = computeGapsHours(senderRecords);
    const expectedGapHours = median(gaps);
    if (expectedGapHours <= 0) {
      return empty;
    }

    const priorRecord = senderRecords[currentIndex - 1];
    const gapHours = (input.receivedAt - priorRecord.receivedAt) / 3_600_000;
    const deviationFactor = gapHours / Math.max(0.5, expectedGapHours);

    let confidence = 40;
    if (senderRecords.length >= 6) confidence += 18;
    else if (senderRecords.length >= 4) confidence += 10;
    if (deviationFactor >= 3.5) confidence += 8;
    if (expectedGapHours <= 4) confidence += 8;
    if (senderRecords.length < 4) confidence -= 15;
    confidence = clamp(confidence, 0, 100);

    if (
      deviationFactor < 2.2 ||
      gapHours < 1.5 ||
      confidence < 38 ||
      input.decisionProfile.attentionType === "verify_now"
    ) {
      return {
        ...empty,
        gapHours: Number(gapHours.toFixed(2)),
        expectedGapHours: Number(expectedGapHours.toFixed(2)),
        deviationFactor: Number(deviationFactor.toFixed(2)),
        confidence,
      };
    }

    let urgencyBoost = deviationFactor > 5 ? 18 : deviationFactor >= 3.5 ? 13 : 8;
    const priorScored = senderRecords
      .slice(0, currentIndex)
      .filter((record) => record.scored);
    if (priorScored.length >= 2) {
      const avgPrior =
        priorScored.reduce((sum, record) => sum + record.priorityScore, 0) / priorScored.length;
      if (avgPrior >= 60) {
        urgencyBoost += 3;
      }
    }
    if (input.decisionProfile.threat >= 55) {
      urgencyBoost += 2;
    }

    return {
      detected: true,
      gapHours: Number(gapHours.toFixed(2)),
      expectedGapHours: Number(expectedGapHours.toFixed(2)),
      deviationFactor: Number(deviationFactor.toFixed(2)),
      urgencyBoost: clamp(urgencyBoost, 0, 18),
      confidence,
      rationale: `Sender broke an intra-batch cadence of ${expectedGapHours.toFixed(1)}h after ${gapHours.toFixed(1)}h of silence.`,
    };
  }

  if (
    input.trustGraph.lastSeen === null ||
    input.trustGraph.seen < 5 ||
    input.decisionProfile.attentionType === "verify_now"
  ) {
    return empty;
  }

  const crossSessionGapHours =
    (input.receivedAt - input.trustGraph.lastSeen.getTime()) / 3_600_000;
  const estimatedCadenceHours = (24 * 7) / Math.max(1, input.trustGraph.seen / 4);
  if (estimatedCadenceHours > 72) {
    return empty;
  }

  const deviationFactor = crossSessionGapHours / Math.max(0.5, estimatedCadenceHours);
  let confidence = 28;
  if (deviationFactor >= 3.5) confidence += 8;
  if (estimatedCadenceHours <= 12) confidence += 8;
  confidence = clamp(confidence, 0, 100);

  if (deviationFactor < 2.5 || crossSessionGapHours < 4 || confidence < 38) {
    return {
      ...empty,
      gapHours: Number(crossSessionGapHours.toFixed(2)),
      expectedGapHours: Number(estimatedCadenceHours.toFixed(2)),
      deviationFactor: Number(deviationFactor.toFixed(2)),
      confidence,
    };
  }

  let urgencyBoost = deviationFactor > 5 ? 18 : deviationFactor >= 3.5 ? 13 : 8;
  if (input.decisionProfile.threat >= 55) {
    urgencyBoost += 2;
  }

  return {
    detected: true,
    gapHours: Number(crossSessionGapHours.toFixed(2)),
    expectedGapHours: Number(estimatedCadenceHours.toFixed(2)),
    deviationFactor: Number(deviationFactor.toFixed(2)),
    urgencyBoost: clamp(urgencyBoost, 0, 18),
    confidence,
    rationale: `Cross-session silence break: sender reappeared after ${crossSessionGapHours.toFixed(1)}h against an estimated ${estimatedCadenceHours.toFixed(1)}h cadence.`,
  };
}

/**
 * Detects whether the current email is a follow-up to an already-scored, still-actionable earlier email in the same thread.
 *
 * Pipeline step: runs after scoreEmail() and before the FP Guard so thread continuity can compound urgency for later messages.
 * False-positive scenario addressed: relies on the explicit scored flag so only completed earlier pipeline outputs can influence follow-up urgency.
 */
function detectUnresolvedThread(input: TemporalContextInput): UnresolvedThreadSignal {
  const empty = defaultUnresolvedThreadSignal(input.threadKeyHash);
  const priorScored = getThreadRecords(input.store, input.threadKeyHash).filter(
    (record) => record.scored && record.receivedAt < input.receivedAt
  );

  if (priorScored.length === 0) {
    return empty;
  }

  const mostRecent = priorScored[priorScored.length - 1];
  const hoursApart = (input.receivedAt - mostRecent.receivedAt) / 3_600_000;
  const wasActionable =
    mostRecent.priorityBand === "high" ||
    mostRecent.priorityBand === "medium" ||
    mostRecent.trustedAction === "escalate" ||
    mostRecent.trustedAction === "quarantine";

  if (
    (mostRecent.routingAction === "auto_triage" && mostRecent.priorityBand === "low") ||
    !wasActionable ||
    hoursApart < 0.25 ||
    hoursApart > 72
  ) {
    return {
      ...empty,
      priorScoredCount: priorScored.length,
      hoursApart: Number(hoursApart.toFixed(2)),
      priorMaxBand: mostRecent.priorityBand,
      priorMaxAction: mostRecent.trustedAction || null,
    };
  }

  let urgencyBoost = 12;
  if (hoursApart < 1) urgencyBoost += 10;
  else if (hoursApart < 4) urgencyBoost += 8;
  else if (hoursApart < 12) urgencyBoost += 5;
  else urgencyBoost += 2;
  if (mostRecent.priorityBand === "high") urgencyBoost += 4;
  if (
    mostRecent.trustedAction === "escalate" ||
    mostRecent.trustedAction === "quarantine"
  ) {
    urgencyBoost += 3;
  }
  if (priorScored.length >= 3) {
    urgencyBoost += 2;
  }
  urgencyBoost = clamp(urgencyBoost, 0, 22);

  let routingOverride: "escalate" | "human_review" | null = null;
  let rationale = `Follow-up to unresolved thread ${hoursApart.toFixed(1)}h after the last scored email.`;
  if (urgencyBoost >= 18 && hoursApart <= 4) {
    routingOverride = "escalate";
    rationale = `Follow-up to unresolved ${mostRecent.priorityBand} priority thread from ${hoursApart.toFixed(1)}h ago - escalating.`;
  } else if (urgencyBoost >= 12 && input.decisionProfile.threat >= 55) {
    routingOverride = "human_review";
    rationale = `Unresolved thread with elevated threat (${input.decisionProfile.threat.toFixed(0)}) - human review.`;
  }

  const priorMaxBand = priorScored.reduce<"high" | "medium" | "low" | null>(
    (current, record) =>
      bandRank(record.priorityBand) > bandRank(current) ? record.priorityBand : current,
    null
  );

  return {
    detected: true,
    threadKeyHash: input.threadKeyHash,
    priorScoredCount: priorScored.length,
    hoursApart: Number(hoursApart.toFixed(2)),
    priorMaxBand,
    priorMaxAction: mostRecent.trustedAction || null,
    urgencyBoost,
    routingOverride,
    rationale,
  };
}

/**
 * Detects whether the current email participates in a cross-domain cluster pattern inside the current batch.
 *
 * Pipeline step: runs after scoreEmail() and before the FP Guard so same-batch campaigns can elevate urgency and threat.
 * False-positive scenario addressed: ignores promotional/general clusters and requires at least two other domains before any convergence boost is returned.
 */
function detectConvergingSignals(input: TemporalContextInput): ConvergingSignalSignal {
  const empty = defaultConvergingSignalSignal(input.clusterKey);

  if (
    input.clusterKey === "general" ||
    input.decisionProfile.primaryCategory === "newsletter" ||
    input.decisionProfile.primaryCategory === "sales_marketing"
  ) {
    return empty;
  }

  const clusterRecords = getClusterRecords(input.store, input.clusterKey, input.senderDomainHash)
    .filter((record) => record.scored || record.receivedAt < input.receivedAt);
  const distinctDomains = new Set(clusterRecords.map((record) => record.senderDomainHash)).size;

  if (distinctDomains < 2) {
    return {
      ...empty,
      distinctDomains,
    };
  }

  let signalStrength = Math.min(55, distinctDomains * 17);
  const scoredRecords = clusterRecords.filter((record) => record.scored);
  const avgScore =
    scoredRecords.length >= 2
      ? scoredRecords.reduce((sum, record) => sum + record.priorityScore, 0) /
        scoredRecords.length
      : 0;
  if (scoredRecords.length >= 2 && avgScore >= 60) {
    signalStrength += 15;
  }

  const anyHarmful = clusterRecords.some(
    (record) => record.trustedAction === "quarantine" || record.trustedAction === "block"
  );
  if (anyHarmful) {
    signalStrength += 20;
  }
  if (clusterRecords.length >= 4) {
    signalStrength += 10;
  }
  signalStrength = clamp(signalStrength, 0, 100);

  const urgencyBoost = clamp(Math.round(signalStrength * 0.28), 0, 24);
  let threatElevation = 0;
  if (
    input.clusterKey === "financial_transaction" ||
    input.clusterKey === "payment_request"
  ) {
    threatElevation = Math.min(18, distinctDomains * 8);
  } else if (input.clusterKey === "executive_impersonation") {
    threatElevation = Math.min(18, distinctDomains * 9);
  }

  let campaignType: ConvergingSignalSignal["campaignType"] = "ambiguous";
  if (
    distinctDomains >= 3 &&
    ["financial_transaction", "payment_request", "executive_impersonation"].includes(
      input.clusterKey
    ) &&
    scoredRecords.length >= 2 &&
    avgScore >= 55
  ) {
    campaignType = "coordinated_attack";
  } else if (
    ["legal_pressure", "deadline_pressure"].includes(input.clusterKey) &&
    !anyHarmful &&
    distinctDomains >= 2
  ) {
    campaignType = "legitimate_convergence";
  }

  return {
    detected: true,
    clusterKey: input.clusterKey,
    distinctDomains,
    signalStrength,
    urgencyBoost,
    threatElevation,
    campaignType,
    rationale: `${distinctDomains} other sender domain(s) converged on ${input.clusterKey.replace(/_/g, " ")} in this batch.`,
  };
}

/**
 * Builds the combined temporal context for one email from the in-memory session store plus the trust-graph bridge.
 *
 * Pipeline step: runs after scoreEmail() and before the FP Guard so temporal context sharpens urgency and routing using only local derived signals.
 * False-positive scenario addressed: enforces an anti-laundering cap so temporal boosts can amplify real signals without turning low-priority noise into high-priority mail.
 */
export function buildTemporalContext(input: TemporalContextInput): TemporalContextResult {
  const silenceBreak = detectSilenceBreak(input);
  const unresolvedThread = detectUnresolvedThread(input);
  const convergingSignal = detectConvergingSignals(input);

  let totalUrgencyDelta =
    (silenceBreak.detected ? silenceBreak.urgencyBoost : 0) +
    (unresolvedThread.detected ? unresolvedThread.urgencyBoost : 0) +
    (convergingSignal.detected ? convergingSignal.urgencyBoost : 0);

  if (
    input.currentPriority?.priorityBand === "low" &&
    input.currentPriority.priorityScore + totalUrgencyDelta > 74
  ) {
    totalUrgencyDelta = Math.max(0, 74 - input.currentPriority.priorityScore);
  }

  totalUrgencyDelta = clamp(totalUrgencyDelta, 0, 30);
  const totalThreatDelta = convergingSignal.detected
    ? clamp(convergingSignal.threatElevation, 0, 18)
    : 0;

  const routingOverride = unresolvedThread.routingOverride
    ? unresolvedThread.routingOverride
    : convergingSignal.campaignType === "coordinated_attack" &&
        convergingSignal.signalStrength >= 65
      ? "human_review"
      : null;

  const temporalFlags: string[] = [];
  if (silenceBreak.detected) {
    temporalFlags.push("temporal:silence_break");
    if (silenceBreak.rationale.startsWith("Cross-session silence break")) {
      temporalFlags.push("temporal:silence_cross_session");
    }
  }
  if (unresolvedThread.detected) {
    temporalFlags.push("temporal:unresolved_thread");
  }
  if (convergingSignal.detected) {
    temporalFlags.push(`temporal:converging:${convergingSignal.clusterKey}`);
    temporalFlags.push(`temporal:campaign:${convergingSignal.campaignType}`);
  }
  if (routingOverride) {
    temporalFlags.push(`temporal:routing:${routingOverride}`);
  }

  return {
    silenceBreak,
    unresolvedThread,
    convergingSignal,
    totalUrgencyDelta,
    totalThreatDelta,
    routingOverride,
    temporalFlags,
  };
}
