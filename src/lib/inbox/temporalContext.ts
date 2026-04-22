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
 * Pipeline step: shared helper used by all temporal detectors before any score delta is returned.
 * False-positive scenario addressed: prevents any single temporal signal from overpowering the base classifier and guardrail stack.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Builds the zero-impact silence-break shape.
 *
 * Pipeline step: returned when sender cadence evidence is too weak to justify an urgency boost.
 * False-positive scenario addressed: sparse sender activity inside the batch should never manufacture urgency.
 */
function defaultSilenceBreakSignal(): SilenceBreakSignal {
  return {
    detected: false,
    gapHours: 0,
    expectedGapHours: 0,
    deviationFactor: 0,
    urgencyBoost: 0,
    confidence: 0,
    rationale: "No meaningful within-batch silence break detected.",
  };
}

/**
 * Builds the zero-impact unresolved-thread shape.
 *
 * Pipeline step: returned when there is no scored prior record in the same thread for the current batch.
 * False-positive scenario addressed: prevents first-touch or already-suppressed threads from gaining false escalation pressure.
 */
function defaultUnresolvedThreadSignal(threadKeyHash: string): UnresolvedThreadSignal {
  return {
    detected: false,
    threadKeyHash,
    priorRecordCount: 0,
    earliestHoursAgo: 0,
    priorMaxBand: null,
    priorMaxAction: null,
    urgencyBoost: 0,
    routingOverride: null,
    rationale: "No unresolved within-batch thread follow-up detected.",
  };
}

/**
 * Builds the zero-impact converging-signal shape.
 *
 * Pipeline step: returned when cross-sender cluster evidence is too weak or too vague.
 * False-positive scenario addressed: avoids turning isolated medium-value messages into fake campaigns.
 */
function defaultConvergingSignalSignal(clusterKey: string): ConvergingSignalSignal {
  return {
    detected: false,
    clusterKey,
    distinctDomains: 0,
    signalStrength: 0,
    urgencyBoost: 0,
    threatElevation: 0,
    campaignType: "ambiguous",
    rationale: "No converging within-batch signal pattern detected.",
  };
}

/**
 * Converts a priority band into a comparable rank.
 *
 * Pipeline step: unresolved-thread detection uses this to report the strongest prior band in the thread.
 * False-positive scenario addressed: ensures high-priority prior items outrank medium and low when computing carry-forward urgency.
 */
function bandRank(band: "high" | "medium" | "low" | null): number {
  if (band === "high") return 3;
  if (band === "medium") return 2;
  if (band === "low") return 1;
  return 0;
}

/**
 * Detects whether the current email breaks the sender's within-batch cadence.
 *
 * Pipeline step: runs after base scoring and before false-positive correction so sender timing can amplify urgency without reading historical storage.
 * False-positive scenario addressed: ignores loose or low-confidence cadence patterns, especially for newsletter and marketing traffic.
 */
function detectSilenceBreak(input: TemporalContextInput): SilenceBreakSignal {
  const empty = defaultSilenceBreakSignal();
  const senderRecords = getSenderRecords(input.store, input.senderDomainHash);
  if (
    senderRecords.length < 3 ||
    input.trust.seen < 4 ||
    input.decisionProfile.primaryCategory === "newsletter" ||
    input.decisionProfile.primaryCategory === "sales_marketing"
  ) {
    return empty;
  }

  const currentIndex = senderRecords.findIndex(
    (record) =>
      record.receivedAt === input.receivedAt &&
      record.threadKeyHash === input.threadKeyHash
  );
  if (currentIndex <= 0) {
    return empty;
  }

  const gaps = computeGapsHours(senderRecords);
  const expectedGapHours = median(gaps);
  if (expectedGapHours <= 0) {
    return empty;
  }

  const priorEmail = senderRecords[currentIndex - 1];
  const currentGapHours = (input.receivedAt - priorEmail.receivedAt) / 3_600_000;
  const deviationFactor = currentGapHours / Math.max(0.5, expectedGapHours);

  let confidence = 35;
  if (senderRecords.length >= 5) confidence += 18;
  else if (senderRecords.length >= 4) confidence += 10;
  if (deviationFactor >= 3.5) confidence += 8;
  if (expectedGapHours <= 4) confidence += 8;
  if (senderRecords.length < 4) confidence -= 20;
  confidence = clamp(confidence, 0, 100);

  if (
    confidence < 38 ||
    deviationFactor < 2.2 ||
    currentGapHours < 1.5 ||
    input.decisionProfile.attentionType === "verify_now"
  ) {
    return {
      ...empty,
      gapHours: Number(currentGapHours.toFixed(2)),
      expectedGapHours: Number(expectedGapHours.toFixed(2)),
      deviationFactor: Number(deviationFactor.toFixed(2)),
      confidence,
    };
  }

  let urgencyBoost = deviationFactor > 5 ? 18 : deviationFactor >= 3.5 ? 13 : 8;
  const priorRecords = senderRecords.slice(0, currentIndex);
  const avgPriorityScore =
    priorRecords.reduce((sum, record) => sum + record.priorityScore, 0) /
    Math.max(1, priorRecords.length);
  if (avgPriorityScore >= 60) urgencyBoost += 3;
  if (input.decisionProfile.threat >= 55) urgencyBoost += 2;
  urgencyBoost = clamp(urgencyBoost, 0, 18);

  return {
    detected: true,
    gapHours: Number(currentGapHours.toFixed(2)),
    expectedGapHours: Number(expectedGapHours.toFixed(2)),
    deviationFactor: Number(deviationFactor.toFixed(2)),
    urgencyBoost,
    confidence,
    rationale: `Sender paused for ${currentGapHours.toFixed(1)}h against a normal ${expectedGapHours.toFixed(1)}h within-batch cadence.`,
  };
}

/**
 * Detects whether the current email is a follow-up to an already-scored, still-active thread in this batch.
 *
 * Pipeline step: runs after base scoring and before false-positive correction so thread follow-ups can inherit urgency from earlier scored records.
 * False-positive scenario addressed: only prior scored thread items count, so unscored placeholders and already-suppressed threads do not create fake escalation.
 */
function detectUnresolvedThread(input: TemporalContextInput): UnresolvedThreadSignal {
  const empty = defaultUnresolvedThreadSignal(input.threadKeyHash);
  const threadRecords = getThreadRecords(input.store, input.threadKeyHash)
    .filter((record) => record.receivedAt < input.receivedAt && record.priorityScore > 0)
    .sort((a, b) => b.receivedAt - a.receivedAt);

  if (threadRecords.length === 0) {
    return empty;
  }

  const mostRecent = threadRecords[0];
  const wasActionable =
    mostRecent.priorityBand === "high" ||
    mostRecent.priorityBand === "medium" ||
    mostRecent.trustedAction === "escalate" ||
    mostRecent.trustedAction === "quarantine";
  const hoursApart = (input.receivedAt - mostRecent.receivedAt) / 3_600_000;

  if (
    (mostRecent.routingAction === "auto_triage" && mostRecent.priorityBand === "low") ||
    !wasActionable ||
    hoursApart < 0.25 ||
    hoursApart > 48
  ) {
    return {
      ...empty,
      priorRecordCount: threadRecords.length,
      earliestHoursAgo: Number(hoursApart.toFixed(2)),
      priorMaxBand: mostRecent.priorityBand,
      priorMaxAction: mostRecent.trustedAction,
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
  if (threadRecords.length >= 3) urgencyBoost += 2;
  urgencyBoost = clamp(urgencyBoost, 0, 22);

  let routingOverride: "escalate" | "human_review" | null = null;
  let rationale = `Thread follow-up arrived ${hoursApart.toFixed(1)}h after an unresolved scored item in the same batch.`;
  if (urgencyBoost >= 18 && hoursApart <= 4) {
    routingOverride = "escalate";
    rationale = `Rapid follow-up to unresolved high-priority thread from ${hoursApart.toFixed(1)}h ago - escalating.`;
  } else if (urgencyBoost >= 12 && input.decisionProfile.threat >= 55) {
    routingOverride = "human_review";
    rationale = "Unresolved thread with elevated threat signals - routing to human review.";
  }

  const strongestBand = threadRecords.reduce<"high" | "medium" | "low" | null>(
    (current, record) =>
      bandRank(record.priorityBand) > bandRank(current) ? record.priorityBand : current,
    null
  );

  return {
    detected: true,
    threadKeyHash: input.threadKeyHash,
    priorRecordCount: threadRecords.length,
    earliestHoursAgo: Number(hoursApart.toFixed(2)),
    priorMaxBand: strongestBand,
    priorMaxAction: mostRecent.trustedAction,
    urgencyBoost,
    routingOverride,
    rationale,
  };
}

/**
 * Detects whether the current email participates in a multi-domain signal cluster inside the same batch.
 *
 * Pipeline step: runs after base scoring and before false-positive correction so coordinated patterns can elevate urgency and threat.
 * False-positive scenario addressed: ignores general clusters and promotional categories, requiring at least two other domains before any convergence boost is returned.
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

  const clusterRecords = getClusterRecords(
    input.store,
    input.clusterKey,
    input.senderDomainHash
  ).filter((record) => record.priorityScore > 0 || record.receivedAt < input.receivedAt);

  const distinctDomains = new Set(clusterRecords.map((record) => record.senderDomainHash)).size;
  if (distinctDomains < 2) {
    return {
      ...empty,
      distinctDomains,
    };
  }

  const avgPriorityScore =
    clusterRecords.reduce((sum, record) => sum + record.priorityScore, 0) /
    Math.max(1, clusterRecords.length);
  const hasBlockedOrQuarantined = clusterRecords.some(
    (record) => record.trustedAction === "quarantine" || record.trustedAction === "block"
  );

  let signalStrength = Math.min(55, distinctDomains * 17);
  if (avgPriorityScore >= 60) signalStrength += 15;
  if (hasBlockedOrQuarantined) signalStrength += 20;
  if (clusterRecords.length >= 4) signalStrength += 10;
  signalStrength = clamp(Math.round(signalStrength), 0, 100);

  const urgencyBoost = clamp(Math.round(signalStrength * 0.28), 0, 24);
  let threatElevation = 0;
  if (
    input.clusterKey === "financial_transaction" ||
    input.clusterKey === "payment_request"
  ) {
    threatElevation = clamp(distinctDomains * 8, 0, 18);
  } else if (input.clusterKey === "executive_impersonation") {
    threatElevation = clamp(distinctDomains * 9, 0, 18);
  }

  let campaignType: ConvergingSignalSignal["campaignType"] = "ambiguous";
  if (
    distinctDomains >= 3 &&
    ["financial_transaction", "payment_request", "executive_impersonation"].includes(
      input.clusterKey
    ) &&
    avgPriorityScore >= 55
  ) {
    campaignType = "coordinated_attack";
  } else if (
    ["legal_pressure", "deadline_pressure"].includes(input.clusterKey) &&
    !hasBlockedOrQuarantined &&
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
    rationale: `${distinctDomains} other domain(s) converged on ${input.clusterKey.replace(/_/g, " ")} within this batch.`,
  };
}

/**
 * Builds the combined temporal context for one email from the in-memory session store.
 *
 * Pipeline step: runs after scoreEmail() and before false-positive correction, using only the current batch's hashed, derived state.
 * False-positive scenario addressed: caps temporal amplification so within-batch patterns can sharpen attention without laundering low-value noise into high-priority certainty.
 */
export function buildTemporalContext(
  input: TemporalContextInput
): TemporalContextResult {
  const silenceBreak = detectSilenceBreak(input);
  const unresolvedThread = detectUnresolvedThread(input);
  const convergingSignal = detectConvergingSignals(input);

  const totalUrgencyDelta = clamp(
    (silenceBreak.detected ? silenceBreak.urgencyBoost : 0) +
      (unresolvedThread.detected ? unresolvedThread.urgencyBoost : 0) +
      (convergingSignal.detected ? convergingSignal.urgencyBoost : 0),
    0,
    30
  );
  const totalThreatDelta = clamp(
    convergingSignal.detected ? convergingSignal.threatElevation : 0,
    0,
    18
  );

  const routingOverride = unresolvedThread.routingOverride
    ? unresolvedThread.routingOverride
    : convergingSignal.campaignType === "coordinated_attack" &&
        convergingSignal.signalStrength >= 65
      ? "human_review"
      : null;

  const temporalFlags: string[] = [];
  if (silenceBreak.detected) temporalFlags.push("temporal:silence_break");
  if (unresolvedThread.detected) temporalFlags.push("temporal:unresolved_thread");
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
