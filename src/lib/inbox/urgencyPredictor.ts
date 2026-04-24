import { createHash } from "crypto";

export type UrgencyPredictorInput = {
  email: {
    receivedAt: Date;
    senderEmail: string;
    senderDomain: string;
    subject: string;
    deadlines: string[];
    body: string;
  };
  trust: {
    senderScore: number;
    seen: number;
    lastSeen: Date | null;
  };
  history: {
    subjectHashes: string[];
    priorPriorityScores: number[];
    outcomeLabels: string[];
    avgResponseGapHours: number | null;
    lastEmailFromSender: Date | null;
  };
  batchContext?: {
    currentSubjectPatternHash: string;
    priorSenderSubjectPatternHashes: string[];
  };
  currentDecisionProfile: {
    urgency: number;
    relevance: number;
    threat: number;
  };
};

export type UrgencyPredictorResult = {
  predictedUrgencyScore: number;
  urgencyDelta: number;
  predictionFactors: Array<{
    factor: string;
    direction: "boost" | "suppress";
    magnitude: number;
    rationale: string;
  }>;
  temporalContext:
    | "operational_window"
    | "close_window"
    | "async_context"
    | "standard";
  predictionConfidence: number;
};

type PredictionFactor = UrgencyPredictorResult["predictionFactors"][number];

/**
 * Clamps a numeric urgency or confidence value into a safe range.
 *
 * Pipeline step: shared utility inside the predictive urgency module.
 * False-positive scenario addressed: prevents predictive boosts or suppressions from producing unstable urgency outputs.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Hashes the exact stored subject form used by incident memory.
 *
 * Pipeline step: subject-trajectory analysis inside predictive urgency.
 * False-positive scenario addressed: keeps recurring exact-subject history comparable with the hashes already persisted in evaluation memory.
 */
function hashStoredSubject(subject: string): string {
  return createHash("sha256")
    .update(`subject:${subject}`)
    .digest("hex")
    .slice(0, 20);
}

/**
 * Produces a sender-velocity factor from historical response-gap estimates.
 *
 * Pipeline step: P1 sender-velocity scoring in predictive urgency.
 * False-positive scenario addressed: avoids over-escalating slow-cadence senders while boosting consistently fast-turnaround senders.
 */
function scoreSenderVelocity(
  avgResponseGapHours: number | null
): PredictionFactor | null {
  if (avgResponseGapHours === null) return null;

  if (avgResponseGapHours < 4) {
    return {
      factor: "P1_sender_velocity",
      direction: "boost",
      magnitude: 14,
      rationale: "Historical sender cadence suggests messages from this sender usually require immediate attention.",
    };
  }
  if (avgResponseGapHours < 24) {
    return {
      factor: "P1_sender_velocity",
      direction: "boost",
      magnitude: 8,
      rationale: "Historical sender cadence suggests this sender usually requires same-day response.",
    };
  }
  if (avgResponseGapHours < 72) {
    return {
      factor: "P1_sender_velocity",
      direction: "boost",
      magnitude: 2,
      rationale: "Sender history looks routine but still mildly time-sensitive.",
    };
  }

  return {
    factor: "P1_sender_velocity",
    direction: "suppress",
    magnitude: 4,
    rationale: "This sender typically moves on a slower cadence, so urgency should be discounted slightly.",
  };
}

/**
 * Evaluates the arrival time against known high-pressure windows.
 *
 * Pipeline step: P2 and P5 temporal-window scoring in predictive urgency.
 * False-positive scenario addressed: suppresses after-hours/weekend mail while boosting operational and close-window patterns.
 */
function scoreTemporalPressureWindow(
  input: UrgencyPredictorInput
): {
  temporalContext: UrgencyPredictorResult["temporalContext"];
  factors: PredictionFactor[];
} {
  const day = input.email.receivedAt.getDay();
  const hour = input.email.receivedAt.getHours();
  const factors: PredictionFactor[] = [];
  let temporalContext: UrgencyPredictorResult["temporalContext"] = "standard";

  const weekend = day === 0 || day === 6;
  const lateNight = hour >= 23 || hour < 5;

  if (day === 1 && hour >= 7 && hour <= 10) {
    temporalContext = "operational_window";
    factors.push({
      factor: "P2_temporal_window",
      direction: "boost",
      magnitude: 10,
      rationale: "Monday morning aligns with a common operational triage window.",
    });
  } else if (day === 5 && hour >= 15 && hour <= 18) {
    temporalContext = "close_window";
    factors.push({
      factor: "P2_temporal_window",
      direction: "boost",
      magnitude: 8,
      rationale: "Friday close-out timing increases the chance that this message needs attention before the week ends.",
    });
  } else if (weekend) {
    temporalContext = "async_context";
    factors.push({
      factor: "P2_temporal_window",
      direction: "suppress",
      magnitude: 12,
      rationale: "Weekend timing usually indicates asynchronous, lower-immediacy communication.",
    });
  } else if (
    lateNight &&
    !(
      input.trust.senderScore >= 78 &&
      input.currentDecisionProfile.threat >= 50
    )
  ) {
    temporalContext = "async_context";
    factors.push({
      factor: "P2_temporal_window",
      direction: "suppress",
      magnitude: 10,
      rationale: "Late-night delivery usually behaves like asynchronous communication unless the sender is highly trusted and threat is already elevated.",
    });
  }

  if (
    input.email.deadlines.length >= 1 &&
    temporalContext === "close_window"
  ) {
    factors.push({
      factor: "P5_organizational_moment",
      direction: "boost",
      magnitude: 7,
      rationale: "Deadline language arriving during the Friday close window is more likely to require action before the week ends.",
    });
  }

  return { temporalContext, factors };
}

/**
 * Detects whether the sender broke their normal cadence or followed up unusually quickly.
 *
 * Pipeline step: P3 conversation-gap analysis in predictive urgency.
 * False-positive scenario addressed: captures pattern breaks that matter more than explicit urgency language alone.
 */
function scoreConversationGap(
  input: UrgencyPredictorInput
): PredictionFactor | null {
  if (!input.history.lastEmailFromSender) return null;

  const gapMs =
    input.email.receivedAt.getTime() - input.history.lastEmailFromSender.getTime();
  if (!Number.isFinite(gapMs) || gapMs <= 0) return null;

  const gapDays = gapMs / 86400000;
  const expectedGapDays =
    (input.history.avgResponseGapHours ?? 48) / 24;

  if (gapDays > expectedGapDays * 2.5) {
    return {
      factor: "P3_conversation_gap",
      direction: "boost",
      magnitude: 16,
      rationale: "Sender broke regular pattern — gap 2.5× longer than usual.",
    };
  }

  if (gapDays < expectedGapDays * 0.3) {
    return {
      factor: "P3_conversation_gap",
      direction: "boost",
      magnitude: 9,
      rationale: "Sender followed up unusually fast — possible escalation.",
    };
  }

  return null;
}

/**
 * Scores subject novelty against the sender's stored subject-history pattern.
 *
 * Pipeline step: P4 subject-line trajectory scoring in predictive urgency.
 * False-positive scenario addressed: recurring digest/update subjects should suppress urgency, while novel subjects from known senders deserve attention.
 */
function scoreSubjectTrajectory(
  input: UrgencyPredictorInput
): PredictionFactor | null {
  const currentHash = hashStoredSubject(input.email.subject);
  const matchingPriorityScores = input.history.subjectHashes.flatMap(
    (subjectHash, index) =>
      subjectHash === currentHash &&
      Number.isFinite(input.history.priorPriorityScores[index])
        ? [input.history.priorPriorityScores[index]]
        : []
  );
  const novelSubject = !input.history.subjectHashes.includes(currentHash);
  const repeatedBatchPattern =
    input.batchContext?.priorSenderSubjectPatternHashes.includes(
      input.batchContext.currentSubjectPatternHash
    ) ?? false;
  const priorBatchPatternCount = input.batchContext?.priorSenderSubjectPatternHashes.filter(
    (subjectPatternHash) =>
      subjectPatternHash === input.batchContext?.currentSubjectPatternHash
  ).length ?? 0;
  const novelBatchPattern =
    Boolean(input.batchContext?.currentSubjectPatternHash) &&
    !repeatedBatchPattern &&
    (input.batchContext?.priorSenderSubjectPatternHashes.length ?? 0) > 0;

  if (novelSubject && input.trust.seen >= 4) {
    return {
      factor: "P4_subject_trajectory",
      direction: "boost",
      magnitude: 11,
      rationale: "Novel subject from an established sender is more likely to indicate a real change in importance.",
    };
  }

  if (novelBatchPattern && input.trust.seen >= 3) {
    return {
      factor: "P4_subject_trajectory",
      direction: "boost",
      magnitude: 7,
      rationale:
        "Novel hashed subject pattern within the current batch suggests a meaningful change from this sender.",
    };
  }

  if (
    !novelSubject &&
    matchingPriorityScores.length > 0 &&
    matchingPriorityScores.reduce((sum, score) => sum + score, 0) /
      matchingPriorityScores.length <
      45
  ) {
    return {
      factor: "P4_subject_trajectory",
      direction: "suppress",
      magnitude: 9,
      rationale: "Recurring low-value subject pattern detected for this sender.",
    };
  }

  if (repeatedBatchPattern && priorBatchPatternCount >= 2 && input.currentDecisionProfile.urgency < 55) {
    return {
      factor: "P4_subject_trajectory",
      direction: "suppress",
      magnitude: 6,
      rationale:
        "Repeated hashed subject pattern within the current batch looks routine rather than newly urgent.",
    };
  }

  return null;
}

/**
 * Builds a confidence score for how trustworthy the predictive urgency estimate is.
 *
 * Pipeline step: final confidence gate in predictive urgency.
 * False-positive scenario addressed: low-history senders should not receive aggressive urgency prediction based on weak evidence.
 */
function computePredictionConfidence(
  input: UrgencyPredictorInput
): number {
  let confidence = 40;

  if (input.history.avgResponseGapHours !== null) confidence += 15;
  if (input.trust.seen >= 5) confidence += 10;
  if (input.history.subjectHashes.length >= 3) confidence += 10;
  if (input.history.lastEmailFromSender !== null) confidence += 8;
  if (input.history.outcomeLabels.length >= 2) confidence += 7;
  if (input.trust.seen < 3) confidence -= 15;

  return clamp(confidence, 0, 100);
}

/**
 * Converts directional factors into a signed urgency shift.
 *
 * Pipeline step: final score aggregation inside predictive urgency.
 * False-positive scenario addressed: keeps suppressive context visible instead of only allowing urgency boosts.
 */
function sumFactorMagnitudes(factors: PredictionFactor[]): number {
  return factors.reduce(
    (sum, factor) =>
      sum + (factor.direction === "boost" ? factor.magnitude : -factor.magnitude),
    0
  );
}

/**
 * Predicts urgency from sender behavior, timing, cadence breaks, and subject novelty before relying only on explicit wording.
 *
 * Pipeline step: predictive urgency layer that runs after initial scoring and before false-positive correction.
 * False-positive scenario addressed: reduces reactive keyword-only urgency while boosting truly time-sensitive patterns from established senders.
 */
export function predictUrgency(
  input: UrgencyPredictorInput
): UrgencyPredictorResult {
  const predictionFactors: PredictionFactor[] = [];

  const senderVelocity = scoreSenderVelocity(input.history.avgResponseGapHours);
  if (senderVelocity) predictionFactors.push(senderVelocity);

  const temporalWindow = scoreTemporalPressureWindow(input);
  predictionFactors.push(...temporalWindow.factors);

  const conversationGap = scoreConversationGap(input);
  if (conversationGap) predictionFactors.push(conversationGap);

  const subjectTrajectory = scoreSubjectTrajectory(input);
  if (subjectTrajectory) predictionFactors.push(subjectTrajectory);

  const rawPredictedUrgency = clamp(
    input.currentDecisionProfile.urgency + sumFactorMagnitudes(predictionFactors),
    0,
    100
  );

  const predictionConfidence = computePredictionConfidence(input);
  const cappedPredictedUrgency =
    rawPredictedUrgency > 95 && rawPredictedUrgency > input.currentDecisionProfile.urgency
      ? 95
      : rawPredictedUrgency;

  let urgencyDelta = cappedPredictedUrgency - input.currentDecisionProfile.urgency;
  if (
    predictionConfidence < 35 ||
    input.currentDecisionProfile.threat >= 78
  ) {
    urgencyDelta = 0;
  }

  return {
    predictedUrgencyScore: cappedPredictedUrgency,
    urgencyDelta,
    predictionFactors,
    temporalContext: temporalWindow.temporalContext,
    predictionConfidence,
  };
}
