import {
  computeGapsHours,
  getClusterRecords,
  getSenderRecords,
  getSubjectPatternRecords,
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
    source: null,
    gapHours: 0,
    expectedGapHours: 0,
    deviationFactor: 0,
    priorCadenceSamples: 0,
    novelSubjectPattern: false,
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
    actionablePriorCount: 0,
    hoursApart: 0,
    priorMaxBand: null,
    priorMaxAction: null,
    novelSubjectPattern: false,
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
    matchedRecordCount: 0,
    matchingSubjectDomains: 0,
    windowSpanHours: 0,
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
 * Computes the time span in hours across a record set.
 *
 * Pipeline step: convergence detection uses this to tell tight coordinated bursts apart from looser routine clustering.
 * False-positive scenario addressed: prevents wide, low-pressure batches from looking like concentrated campaigns.
 */
function computeWindowSpanHours(
  records: Array<{
    receivedAt: number;
  }>
): number {
  if (records.length < 2) {
    return 0;
  }

  const receivedTimes = records.map((record) => record.receivedAt);
  return (Math.max(...receivedTimes) - Math.min(...receivedTimes)) / 3_600_000;
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
        record.receivedAt === input.receivedAt &&
        record.threadKeyHash === input.threadKeyHash &&
        record.subjectPatternHash === input.subjectPatternHash
    );
    if (currentIndex >= 2) {
      const historyRecords = senderRecords.slice(0, currentIndex);
      const priorRecord = historyRecords[historyRecords.length - 1];
      if (!priorRecord) {
        return empty;
      }

      const historicalGaps = computeGapsHours(historyRecords);
      const firstHistoryRecord = historyRecords[0];
      const expectedGapHours =
        historicalGaps.length > 0
          ? median(historicalGaps)
          : firstHistoryRecord
            ? (priorRecord.receivedAt - firstHistoryRecord.receivedAt) / 3_600_000
            : 0;
      if (expectedGapHours <= 0) {
        return empty;
      }

      const gapHours = (input.receivedAt - priorRecord.receivedAt) / 3_600_000;
      const deviationFactor = gapHours / Math.max(0.5, expectedGapHours);
      const priorPatternSeen = historyRecords.some(
        (record) => record.subjectPatternHash === input.subjectPatternHash
      );
      const novelSubjectPattern = !priorPatternSeen;

      let confidence = 40;
      if (historyRecords.length >= 5) confidence += 18;
      else if (historyRecords.length >= 3) confidence += 10;
      if (deviationFactor >= 3.5) confidence += 8;
      if (expectedGapHours <= 4) confidence += 8;
      if (novelSubjectPattern) confidence += 6;
      if (historyRecords.length < 3) confidence -= 15;
      confidence = clamp(confidence, 0, 100);

      if (
        deviationFactor < 2.2 ||
        gapHours < 1.5 ||
        confidence < 38 ||
        input.decisionProfile.attentionType === "verify_now"
      ) {
        return {
          ...empty,
          source: "intra_batch",
          gapHours: Number(gapHours.toFixed(2)),
          expectedGapHours: Number(expectedGapHours.toFixed(2)),
          deviationFactor: Number(deviationFactor.toFixed(2)),
          priorCadenceSamples: historyRecords.length,
          novelSubjectPattern,
          confidence,
        };
      }

      let urgencyBoost = deviationFactor > 5 ? 18 : deviationFactor >= 3.5 ? 13 : 8;
      const priorScored = historyRecords.filter((record) => record.scored);
      if (priorScored.length >= 2) {
        const avgPrior =
          priorScored.reduce((sum, record) => sum + record.priorityScore, 0) /
          priorScored.length;
        if (avgPrior >= 60) {
          urgencyBoost += 3;
        }
      }
      if (novelSubjectPattern) {
        urgencyBoost += 2;
      }
      if (input.decisionProfile.threat >= 55) {
        urgencyBoost += 2;
      }

      const noveltyNote = novelSubjectPattern
        ? " A new hashed subject pattern also appeared after the silence."
        : "";

      return {
        detected: true,
        source: "intra_batch",
        gapHours: Number(gapHours.toFixed(2)),
        expectedGapHours: Number(expectedGapHours.toFixed(2)),
        deviationFactor: Number(deviationFactor.toFixed(2)),
        priorCadenceSamples: historyRecords.length,
        novelSubjectPattern,
        urgencyBoost: clamp(urgencyBoost, 0, 18),
        confidence,
        rationale: `Sender broke an intra-batch cadence of ${expectedGapHours.toFixed(1)}h after ${gapHours.toFixed(1)}h of silence.${noveltyNote}`.trim(),
      };
    }
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
      source: "cross_session",
      gapHours: Number(crossSessionGapHours.toFixed(2)),
      expectedGapHours: Number(estimatedCadenceHours.toFixed(2)),
      deviationFactor: Number(deviationFactor.toFixed(2)),
      priorCadenceSamples: 0,
      confidence,
    };
  }

  let urgencyBoost = deviationFactor > 5 ? 18 : deviationFactor >= 3.5 ? 13 : 8;
  if (input.decisionProfile.threat >= 55) {
    urgencyBoost += 2;
  }

  return {
    detected: true,
    source: "cross_session",
    gapHours: Number(crossSessionGapHours.toFixed(2)),
    expectedGapHours: Number(estimatedCadenceHours.toFixed(2)),
    deviationFactor: Number(deviationFactor.toFixed(2)),
    priorCadenceSamples: 0,
    novelSubjectPattern: false,
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
  const actionablePrior = priorScored.filter(
    (record) =>
      record.priorityBand === "high" ||
      record.priorityBand === "medium" ||
      record.trustedAction === "escalate" ||
      record.trustedAction === "quarantine" ||
      record.urgencyScore >= 62
  );
  const anchorRecord =
    actionablePrior.length > 0
      ? actionablePrior[actionablePrior.length - 1]
      : mostRecent;
  const hoursApart = (input.receivedAt - anchorRecord.receivedAt) / 3_600_000;
  const wasActionable = actionablePrior.length > 0;
  const novelSubjectPattern = !priorScored.some(
    (record) => record.subjectPatternHash === input.subjectPatternHash
  );

  if (
    (mostRecent.routingAction === "auto_triage" && mostRecent.priorityBand === "low") ||
    !wasActionable ||
    hoursApart < 0.25 ||
    hoursApart > 72
  ) {
    return {
      ...empty,
      priorScoredCount: priorScored.length,
      actionablePriorCount: actionablePrior.length,
      hoursApart: Number(hoursApart.toFixed(2)),
      priorMaxBand: anchorRecord.priorityBand,
      priorMaxAction: anchorRecord.trustedAction || null,
      novelSubjectPattern,
    };
  }

  let urgencyBoost = 12;
  if (hoursApart < 1) urgencyBoost += 10;
  else if (hoursApart < 4) urgencyBoost += 8;
  else if (hoursApart < 12) urgencyBoost += 5;
  else urgencyBoost += 2;
  if (anchorRecord.priorityBand === "high") urgencyBoost += 4;
  if (
    anchorRecord.trustedAction === "escalate" ||
    anchorRecord.trustedAction === "quarantine"
  ) {
    urgencyBoost += 3;
  }
  if (priorScored.length >= 3) {
    urgencyBoost += 2;
  }
  if (novelSubjectPattern) {
    urgencyBoost += 2;
  }
  urgencyBoost = clamp(urgencyBoost, 0, 22);

  let routingOverride: "escalate" | "human_review" | null = null;
  let rationale = `Follow-up to unresolved thread ${hoursApart.toFixed(1)}h after the last actionable item.`;
  if (urgencyBoost >= 18 && hoursApart <= 6) {
    routingOverride = "escalate";
    rationale = `Follow-up to unresolved ${anchorRecord.priorityBand} priority thread from ${hoursApart.toFixed(1)}h ago - escalating.`;
  } else if (
    urgencyBoost >= 12 &&
    (input.decisionProfile.threat >= 55 ||
      (novelSubjectPattern && input.decisionProfile.threat >= 40))
  ) {
    routingOverride = "human_review";
    rationale = novelSubjectPattern
      ? `Unresolved thread shifted into a new hashed subject pattern with elevated threat (${input.decisionProfile.threat.toFixed(0)}) - human review.`
      : `Unresolved thread with elevated threat (${input.decisionProfile.threat.toFixed(0)}) - human review.`;
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
    actionablePriorCount: actionablePrior.length,
    hoursApart: Number(hoursApart.toFixed(2)),
    priorMaxBand,
    priorMaxAction: anchorRecord.trustedAction || null,
    novelSubjectPattern,
    urgencyBoost,
    routingOverride,
    rationale: novelSubjectPattern && !rationale.includes("new hashed subject pattern")
      ? `${rationale} The follow-up also introduced a new hashed subject pattern on the open thread.`
      : rationale,
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
  const samePatternRecords = getSubjectPatternRecords(
    input.store,
    input.subjectPatternHash,
    input.senderDomainHash
  ).filter((record) => record.receivedAt < input.receivedAt);
  const matchingSubjectDomains = new Set(
    samePatternRecords.map((record) => record.senderDomainHash)
  ).size;
  const windowSpanHours = computeWindowSpanHours([
    ...clusterRecords,
    { receivedAt: input.receivedAt },
  ]);

  if (distinctDomains < 2) {
    return {
      ...empty,
      distinctDomains,
      matchedRecordCount: clusterRecords.length,
      matchingSubjectDomains,
      windowSpanHours: Number(windowSpanHours.toFixed(2)),
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
  if (matchingSubjectDomains >= 1) {
    signalStrength += 12;
  }
  if (windowSpanHours <= 12) {
    signalStrength += 8;
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
    distinctDomains + 1 >= 3 &&
    ["financial_transaction", "payment_request", "executive_impersonation"].includes(
      input.clusterKey
    ) &&
    (scoredRecords.length >= 2 || matchingSubjectDomains >= 1) &&
    (avgScore >= 55 || matchingSubjectDomains >= 2 || windowSpanHours <= 8)
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
    matchedRecordCount: clusterRecords.length,
    matchingSubjectDomains,
    windowSpanHours: Number(windowSpanHours.toFixed(2)),
    signalStrength,
    urgencyBoost,
    threatElevation,
    campaignType,
    rationale:
      matchingSubjectDomains > 0
        ? `${distinctDomains} other sender domain(s) converged on ${input.clusterKey.replace(/_/g, " ")} in this batch, including ${matchingSubjectDomains} domain(s) sharing the same hashed subject pattern within ${windowSpanHours.toFixed(1)}h.`
        : `${distinctDomains} other sender domain(s) converged on ${input.clusterKey.replace(/_/g, " ")} in this batch within ${windowSpanHours.toFixed(1)}h.`,
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

  const dominantTemporalSignal =
    unresolvedThread.detected && unresolvedThread.urgencyBoost >= silenceBreak.urgencyBoost
      ? unresolvedThread.urgencyBoost >= convergingSignal.urgencyBoost
        ? "unresolved_thread"
        : "converging_signal"
      : silenceBreak.detected && silenceBreak.urgencyBoost >= convergingSignal.urgencyBoost
        ? "silence_break"
        : convergingSignal.detected
          ? "converging_signal"
          : null;
  const explanationNotes = [
    ...(silenceBreak.detected ? [silenceBreak.rationale] : []),
    ...(unresolvedThread.detected ? [unresolvedThread.rationale] : []),
    ...(convergingSignal.detected ? [convergingSignal.rationale] : []),
    ...(routingOverride
      ? [`Temporal routing override applied: ${routingOverride}.`]
      : []),
  ].slice(0, 4);

  return {
    silenceBreak,
    unresolvedThread,
    convergingSignal,
    totalUrgencyDelta,
    totalThreatDelta,
    routingOverride,
    temporalFlags,
    dominantTemporalSignal,
    explanationNotes,
  };
}
