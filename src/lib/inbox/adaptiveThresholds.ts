import fs from "fs/promises";
import path from "path";

export type AdaptiveThresholdRecommendation = {
  autoTriageConfidenceMin: number;
  autoTriageUncertaintyMax: number;
  escalateConfidenceMin: number;
  escalateUncertaintyMax: number;
  riskMediumMin: number;
  riskHighMin: number;
  harmfulPriorityFloor: number;
  urgentDecisionFloor: number;
  deadlineHighFloor: number;
  routineNoiseCap: number;
  attentionHighFloor: number;
  attentionUrgentFloor: number;
  securitySuspiciousFloor: number;
  securityHarmfulFloor: number;
  surfaceAttentionFloor: number;
  escalateSecurityFloor: number;
  promoSuppressionSensitivity: number;
  mustNotMissFloor: number;
};

type AttentionPriorityLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "urgent";
type SecuritySeverityLevel =
  | "benign"
  | "noisy"
  | "suspicious"
  | "harmful"
  | "critical";
type ActionRoute =
  | "suppress"
  | "surface"
  | "escalate"
  | "quarantine"
  | "block";

export type AdaptiveThresholdInput = {
  outcomeHistory: Array<{
    priorityScore: number;
    priorityBand: "high" | "medium" | "low";
    outcomeLabel: string;
    mailClass: string;
    primaryCategory: string;
    fpGuardActivated: boolean;
    fpGuardDelta: number;
    consensusScore: number;
    uncertainty: number;
    timestamp: Date;
    routingAction?: string;
    attentionPriority?: AttentionPriorityLevel;
    securitySeverity?: SecuritySeverityLevel;
    actionRoute?: ActionRoute;
  }>;
  currentThresholds: AdaptiveThresholdRecommendation;
  minSampleSize: number;
};

export type AdaptiveThresholdResult = {
  recommended: AdaptiveThresholdRecommendation;
  adjustments: Array<{
    threshold: string;
    oldValue: number;
    newValue: number;
    direction: "tightened" | "relaxed";
    reason: string;
    confidence: number;
  }>;
  diagnostics: {
    sampleSize: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    fpGuardEffectiveness: number;
    avgUncertaintyAtFP: number;
    dominantFPCategory: string;
    effectiveSampleWeight: number;
    promoPressure: number;
    protectedLaneMissRate: number;
    harmfulMissRate: number;
    recommendedFocus: string;
  };
};

const THRESHOLD_BOUNDS: Record<keyof AdaptiveThresholdRecommendation, [number, number]> = {
  autoTriageConfidenceMin: [70, 92],
  autoTriageUncertaintyMax: [18, 40],
  escalateConfidenceMin: [50, 75],
  escalateUncertaintyMax: [38, 62],
  riskMediumMin: [38, 58],
  riskHighMin: [58, 78],
  harmfulPriorityFloor: [78, 92],
  urgentDecisionFloor: [74, 88],
  deadlineHighFloor: [72, 86],
  routineNoiseCap: [26, 44],
  attentionHighFloor: [64, 84],
  attentionUrgentFloor: [82, 96],
  securitySuspiciousFloor: [30, 52],
  securityHarmfulFloor: [60, 82],
  surfaceAttentionFloor: [48, 72],
  escalateSecurityFloor: [58, 82],
  promoSuppressionSensitivity: [30, 80],
  mustNotMissFloor: [68, 90],
};

const ADAPTIVE_THRESHOLD_DEFAULTS: Pick<
  AdaptiveThresholdRecommendation,
  | "attentionHighFloor"
  | "attentionUrgentFloor"
  | "securitySuspiciousFloor"
  | "securityHarmfulFloor"
  | "surfaceAttentionFloor"
  | "escalateSecurityFloor"
  | "promoSuppressionSensitivity"
  | "mustNotMissFloor"
> = {
  attentionHighFloor: 75,
  attentionUrgentFloor: 88,
  securitySuspiciousFloor: 40,
  securityHarmfulFloor: 70,
  surfaceAttentionFloor: 58,
  escalateSecurityFloor: 72,
  promoSuppressionSensitivity: 50,
  mustNotMissFloor: 80,
};

/**
 * Clamps a threshold or diagnostic value into a safe numeric range.
 *
 * Pipeline step: shared utility across adaptive-threshold computation and persistence loading.
 * False-positive scenario addressed: prevents a noisy scan cycle from pushing thresholds beyond safe operating rails.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts an unknown value into a finite number or returns null when coercion is unsafe.
 *
 * Pipeline step: adaptive-threshold cache deserialization helper.
 * False-positive scenario addressed: prevents corrupted cache payloads from silently injecting NaN thresholds into the scanner.
 */
function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Computes the arithmetic mean for a numeric set, returning zero for empty input.
 *
 * Pipeline step: adaptive diagnostics and threshold calibration helper.
 * False-positive scenario addressed: lets the calibrator reason from batch behavior instead of reacting to one outlier mistake.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function recencyWeight(timestamp: Date, now = Date.now()): number {
  const ageMs = Math.max(0, now - timestamp.getTime());
  const ageDays = ageMs / 86400000;
  return clamp(Math.exp(-ageDays / 21), 0.18, 1);
}

function weightedSum<T>(
  values: T[],
  selector: (value: T) => boolean,
  weightOf: (value: T) => number
): number {
  return values.reduce(
    (sum, value) => sum + (selector(value) ? weightOf(value) : 0),
    0
  );
}

function scaledDelta(
  rawValue: number,
  maxMagnitude: number,
  adaptationStrength: number
): number {
  const scaled = Math.round(rawValue * adaptationStrength);
  return clamp(scaled, -maxMagnitude, maxMagnitude);
}

function isPromoCategory(primaryCategory: string): boolean {
  return primaryCategory === "sales_marketing" || primaryCategory === "newsletter";
}

function isProtectedCategory(primaryCategory: string): boolean {
  return [
    "finance_payment",
    "ops_support",
    "deadline_scheduling",
    "legal_contract",
    "security_phishing",
  ].includes(primaryCategory);
}

function isImportantBenignOutcome(
  entry: AdaptiveThresholdInput["outcomeHistory"][number]
): boolean {
  return (
    entry.outcomeLabel === "actionable_correct" ||
    entry.outcomeLabel === "spam_false_positive" ||
    entry.outcomeLabel === "harmful_false_positive" ||
    (entry.outcomeLabel === "informational_correct" && entry.priorityScore >= 55)
  );
}

function isLowAttention(
  level: AttentionPriorityLevel | undefined
): boolean {
  return level === "none" || level === "low";
}

function isBelowHarmful(
  level: SecuritySeverityLevel | undefined
): boolean {
  return level !== "harmful" && level !== "critical";
}

/**
 * Builds a confidence score for an adaptive threshold move from sample size and magnitude.
 *
 * Pipeline step: adjustment explanation inside adaptive threshold calibration.
 * False-positive scenario addressed: helps separate strong feedback-driven moves from weak, noisy suggestions.
 */
function adjustmentConfidence(
  sampleSize: number,
  deltaMagnitude: number
): number {
  return clamp(
    Math.round(35 + Math.min(30, sampleSize * 1.4) + Math.min(25, deltaMagnitude * 4)),
    0,
    100
  );
}

/**
 * Clamps the full recommendation object into the safe threshold rails defined for the inbox pipeline.
 *
 * Pipeline step: Step F of adaptive threshold calibration.
 * False-positive scenario addressed: ensures self-tuning can tighten or relax the pipeline without destabilizing core routing behavior.
 */
function clampRecommendation(
  recommendation: AdaptiveThresholdRecommendation
): AdaptiveThresholdRecommendation {
  return {
    autoTriageConfidenceMin: clamp(
      recommendation.autoTriageConfidenceMin,
      ...THRESHOLD_BOUNDS.autoTriageConfidenceMin
    ),
    autoTriageUncertaintyMax: clamp(
      recommendation.autoTriageUncertaintyMax,
      ...THRESHOLD_BOUNDS.autoTriageUncertaintyMax
    ),
    escalateConfidenceMin: clamp(
      recommendation.escalateConfidenceMin,
      ...THRESHOLD_BOUNDS.escalateConfidenceMin
    ),
    escalateUncertaintyMax: clamp(
      recommendation.escalateUncertaintyMax,
      ...THRESHOLD_BOUNDS.escalateUncertaintyMax
    ),
    riskMediumMin: clamp(
      recommendation.riskMediumMin,
      ...THRESHOLD_BOUNDS.riskMediumMin
    ),
    riskHighMin: clamp(
      recommendation.riskHighMin,
      ...THRESHOLD_BOUNDS.riskHighMin
    ),
    harmfulPriorityFloor: clamp(
      recommendation.harmfulPriorityFloor,
      ...THRESHOLD_BOUNDS.harmfulPriorityFloor
    ),
    urgentDecisionFloor: clamp(
      recommendation.urgentDecisionFloor,
      ...THRESHOLD_BOUNDS.urgentDecisionFloor
    ),
    deadlineHighFloor: clamp(
      recommendation.deadlineHighFloor,
      ...THRESHOLD_BOUNDS.deadlineHighFloor
    ),
    routineNoiseCap: clamp(
      recommendation.routineNoiseCap,
      ...THRESHOLD_BOUNDS.routineNoiseCap
    ),
    attentionHighFloor: clamp(
      recommendation.attentionHighFloor,
      ...THRESHOLD_BOUNDS.attentionHighFloor
    ),
    attentionUrgentFloor: clamp(
      recommendation.attentionUrgentFloor,
      ...THRESHOLD_BOUNDS.attentionUrgentFloor
    ),
    securitySuspiciousFloor: clamp(
      recommendation.securitySuspiciousFloor,
      ...THRESHOLD_BOUNDS.securitySuspiciousFloor
    ),
    securityHarmfulFloor: clamp(
      recommendation.securityHarmfulFloor,
      ...THRESHOLD_BOUNDS.securityHarmfulFloor
    ),
    surfaceAttentionFloor: clamp(
      recommendation.surfaceAttentionFloor,
      ...THRESHOLD_BOUNDS.surfaceAttentionFloor
    ),
    escalateSecurityFloor: clamp(
      recommendation.escalateSecurityFloor,
      ...THRESHOLD_BOUNDS.escalateSecurityFloor
    ),
    promoSuppressionSensitivity: clamp(
      recommendation.promoSuppressionSensitivity,
      ...THRESHOLD_BOUNDS.promoSuppressionSensitivity
    ),
    mustNotMissFloor: clamp(
      recommendation.mustNotMissFloor,
      ...THRESHOLD_BOUNDS.mustNotMissFloor
    ),
  };
}

/**
 * Adds an adjustment record when a threshold value actually changed.
 *
 * Pipeline step: adjustment ledger construction during adaptive calibration.
 * False-positive scenario addressed: gives operators a concrete audit trail for why self-tuning changed a threshold.
 */
function recordAdjustment(
  adjustments: AdaptiveThresholdResult["adjustments"],
  threshold: keyof AdaptiveThresholdRecommendation,
  oldValue: number,
  newValue: number,
  reason: string,
  sampleSize: number
): void {
  if (oldValue === newValue) return;

  adjustments.push({
    threshold,
    oldValue,
    newValue,
    direction: newValue > oldValue ? "tightened" : "relaxed",
    reason,
    confidence: adjustmentConfidence(sampleSize, Math.abs(newValue - oldValue)),
  });
}

/**
 * Finds the primary category that dominates false-positive outcomes in the current history window.
 *
 * Pipeline step: false-positive diagnostics used by adaptive calibration Step D.
 * False-positive scenario addressed: lets the calibrator focus on whichever business lane is currently generating the most noisy surfacing.
 */
function dominantCategory(
  categories: string[]
): string {
  if (categories.length === 0) return "none";

  const counts = new Map<string, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let winner = "none";
  let maxCount = 0;
  for (const [category, count] of counts.entries()) {
    if (count > maxCount) {
      winner = category;
      maxCount = count;
    }
  }
  return winner;
}

/**
 * Produces a single diagnostic sentence describing the next most useful tuning focus.
 *
 * Pipeline step: final adaptive diagnostic generation.
 * False-positive scenario addressed: keeps the learning loop actionable instead of just reporting raw numbers.
 */
function buildRecommendedFocus(args: {
  sampleSize: number;
  effectiveSampleWeight: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  truePositiveRate: number;
  dominantFPCategory: string;
  fpGuardActivationRate: number;
  promoPressure: number;
  protectedLaneMissRate: number;
  harmfulMissRate: number;
}): string {
  if (args.sampleSize === 0) {
    return "No labeled outcome history is available yet, so the scanner is still operating on static defaults.";
  }
  if (args.effectiveSampleWeight < 6) {
    return "More labeled outcomes are needed before adaptive calibration should move thresholds aggressively.";
  }
  if (args.fpGuardActivationRate < 0.08) {
    return "Consider lowering FP Guard rule thresholds — guard is underactivating relative to observed false positives.";
  }
  if (args.fpGuardActivationRate > 0.55) {
    return "FP Guard activating on majority of emails — review rule sensitivity before tightening more thresholds.";
  }
  if (args.protectedLaneMissRate > 0.18) {
    return "Important benign mail is still getting buried — lower must-not-miss and attention floors before tightening promo suppression further.";
  }
  if (args.promoPressure > 0.2 && args.dominantFPCategory !== "none") {
    return `Promo fatigue is still leaking through in ${args.dominantFPCategory}; tighten promo suppression without changing harmful thresholds.`;
  }
  if (args.harmfulMissRate > 0.08) {
    return "Missed harmful mail still needs attention — lower security and routing thresholds before loosening user-attention settings.";
  }
  if (args.falsePositiveRate > args.falseNegativeRate && args.dominantFPCategory !== "none") {
    return `False positives are clustering in ${args.dominantFPCategory}; prioritize tuning that lane before widening auto-triage.`;
  }
  if (args.falseNegativeRate > 0) {
    return "False negatives matter most right now — review high-risk routing conservatism before loosening any threshold.";
  }
  if (args.truePositiveRate > 0) {
    return "High-risk handling is catching labeled threats consistently; keep collecting feedback and favor threshold stability.";
  }
  return "Thresholds are relatively stable; keep collecting feedback and monitor drift rather than making aggressive changes.";
}

/**
 * Computes the next-scan adaptive threshold recommendation from labeled inbox history.
 *
 * Pipeline step: batch calibration step that runs after a scan completes and feeds the next scan cycle.
 * False-positive scenario addressed: closes the feedback loop so repeated mistakes tighten or relax the scanner automatically instead of leaving static thresholds in place.
 */
export function computeAdaptiveThresholds(
  input: AdaptiveThresholdInput
): AdaptiveThresholdResult {
  const sampleSize = input.outcomeHistory.length;
  const adjustments: AdaptiveThresholdResult["adjustments"] = [];
  const current = clampRecommendation(input.currentThresholds);
  const now = Date.now();
  const weightedSampleSize = input.outcomeHistory.reduce(
    (sum, entry) => sum + recencyWeight(entry.timestamp, now),
    0
  );
  const warmStartSampleSize = Math.max(6, Math.floor(input.minSampleSize * 0.5));

  const fps = input.outcomeHistory.filter(
    (entry) =>
      entry.outcomeLabel === "spam_false_positive" ||
      entry.outcomeLabel === "harmful_false_positive"
  );
  const fns = input.outcomeHistory.filter(
    (entry) =>
      entry.outcomeLabel === "harmful_true_positive" &&
      entry.routingAction === "auto_triage"
  );
  const tps = input.outcomeHistory.filter(
    (entry) =>
      entry.outcomeLabel === "harmful_true_positive" &&
      (entry.routingAction === "escalate" ||
        entry.routingAction === "human_review")
  );
  const correct = input.outcomeHistory.filter((entry) =>
    entry.outcomeLabel.endsWith("_correct")
  );
  const falsePositiveRate = sampleSize > 0 ? fps.length / sampleSize : 0;
  const falseNegativeRate = sampleSize > 0 ? fns.length / sampleSize : 0;
  const truePositiveRate = sampleSize > 0 ? tps.length / sampleSize : 0;
  const avgPriorityScoreAtFP = mean(fps.map((entry) => entry.priorityScore));
  const avgPriorityScoreAtFN = mean(fns.map((entry) => entry.priorityScore));
  const avgUncertaintyAtFP = mean(fps.map((entry) => entry.uncertainty));
  const dominantFPCategory = dominantCategory(
    fps.map((entry) => entry.primaryCategory)
  );
  const fpGuardFired = input.outcomeHistory.filter((entry) => entry.fpGuardActivated);
  const fpGuardEffectiveness = mean(
    fpGuardFired.map((entry) => Math.abs(entry.fpGuardDelta))
  );
  const fpGuardActivationRate =
    sampleSize > 0 ? fpGuardFired.length / sampleSize : 0;
  const adaptationStrength =
    sampleSize < warmStartSampleSize
      ? 0
      : clamp(weightedSampleSize / Math.max(input.minSampleSize, 1), 0.35, 1);

  const weightOf = (
    entry: AdaptiveThresholdInput["outcomeHistory"][number]
  ): number => recencyWeight(entry.timestamp, now);

  const promoNoiseConfirmed = weightedSum(
    input.outcomeHistory,
    (entry) => isPromoCategory(entry.primaryCategory) && entry.outcomeLabel === "spam_true_positive",
    weightOf
  );
  const protectedLaneMisses = weightedSum(
    input.outcomeHistory,
    (entry) =>
      isProtectedCategory(entry.primaryCategory) &&
      isImportantBenignOutcome(entry) &&
      (isLowAttention(entry.attentionPriority) ||
        entry.actionRoute === "suppress" ||
        entry.routingAction === "human_review"),
    weightOf
  );
  const protectedLaneSamples = weightedSum(
    input.outcomeHistory,
    (entry) => isProtectedCategory(entry.primaryCategory) && isImportantBenignOutcome(entry),
    weightOf
  );
  const harmfulSeverityMisses = weightedSum(
    input.outcomeHistory,
    (entry) =>
      entry.outcomeLabel === "harmful_true_positive" &&
      isBelowHarmful(entry.securitySeverity),
    weightOf
  );
  const harmfulRouteMisses = weightedSum(
    input.outcomeHistory,
    (entry) =>
      entry.outcomeLabel === "harmful_true_positive" &&
      (entry.actionRoute === "surface" || entry.routingAction === "auto_triage"),
    weightOf
  );
  const harmfulSamples = weightedSum(
    input.outcomeHistory,
    (entry) => entry.outcomeLabel === "harmful_true_positive",
    weightOf
  );
  const urgentProtectedMisses = weightedSum(
    input.outcomeHistory,
    (entry) =>
      isProtectedCategory(entry.primaryCategory) &&
      isImportantBenignOutcome(entry) &&
      entry.priorityScore >= 80 &&
      entry.attentionPriority !== "urgent",
    weightOf
  );
  const humanReviewBenignNoise = weightedSum(
    input.outcomeHistory,
    (entry) =>
      isImportantBenignOutcome(entry) &&
      entry.routingAction === "human_review" &&
      (entry.securitySeverity === "benign" || entry.securitySeverity === "noisy"),
    weightOf
  );
  const promoPressure =
    weightedSampleSize > 0 ? promoNoiseConfirmed / weightedSampleSize : 0;
  const protectedLaneMissRate =
    protectedLaneSamples > 0 ? protectedLaneMisses / protectedLaneSamples : 0;
  const harmfulMissRate =
    harmfulSamples > 0
      ? (harmfulSeverityMisses + harmfulRouteMisses * 0.7) /
        Math.max(harmfulSamples, 1)
      : 0;

  if (sampleSize < warmStartSampleSize) {
    return {
      recommended: current,
      adjustments: [],
      diagnostics: {
        sampleSize,
        falsePositiveRate: Number(falsePositiveRate.toFixed(3)),
        falseNegativeRate: Number(falseNegativeRate.toFixed(3)),
        fpGuardEffectiveness: Number(fpGuardEffectiveness.toFixed(2)),
        avgUncertaintyAtFP: Number(avgUncertaintyAtFP.toFixed(2)),
        dominantFPCategory,
        effectiveSampleWeight: Number(weightedSampleSize.toFixed(2)),
        promoPressure: Number(promoPressure.toFixed(3)),
        protectedLaneMissRate: Number(protectedLaneMissRate.toFixed(3)),
        harmfulMissRate: Number(harmfulMissRate.toFixed(3)),
        recommendedFocus: buildRecommendedFocus({
          sampleSize,
          effectiveSampleWeight: weightedSampleSize,
          falsePositiveRate,
          falseNegativeRate,
          truePositiveRate,
          dominantFPCategory,
          fpGuardActivationRate,
          promoPressure,
          protectedLaneMissRate,
          harmfulMissRate,
        }),
      },
    };
  }

  const recommended: AdaptiveThresholdRecommendation = { ...current };

  if (falsePositiveRate > 0.18) {
    recommended.autoTriageConfidenceMin += scaledDelta(
      Math.min(
        6,
        (falsePositiveRate - 0.18) * 40
      ),
      6,
      adaptationStrength
    );
    recommended.autoTriageUncertaintyMax -= scaledDelta(
      Math.min(
        5,
        (falsePositiveRate - 0.18) * 30
      ),
      5,
      adaptationStrength
    );
  } else if (
    falsePositiveRate < 0.06 &&
    sampleSize > 0 &&
    correct.length / sampleSize > 0.72
  ) {
    recommended.autoTriageConfidenceMin -= scaledDelta(
      Math.min(
        4,
        (0.06 - falsePositiveRate) * 30
      ),
      4,
      adaptationStrength
    );
    recommended.autoTriageUncertaintyMax += scaledDelta(
      Math.min(
        3,
        (0.06 - falsePositiveRate) * 20
      ),
      3,
      adaptationStrength
    );
  }

  if (avgPriorityScoreAtFP >= 50 && avgPriorityScoreAtFP < 80) {
    recommended.riskMediumMin += scaledDelta(
      Math.min(
        5,
        (avgPriorityScoreAtFP - 50) * 0.2
      ),
      5,
      adaptationStrength
    );
  }

  if (fns.length > 0 && avgPriorityScoreAtFN < current.riskHighMin) {
    recommended.riskHighMin -= scaledDelta(
      Math.min(
        6,
        (current.riskHighMin - avgPriorityScoreAtFN) * 0.3
      ),
      6,
      adaptationStrength
    );
  }

  if (fps.length > 0 && avgUncertaintyAtFP < 35) {
    recommended.harmfulPriorityFloor += scaledDelta(
      Math.min(
        4,
        (35 - avgUncertaintyAtFP) * 0.15
      ),
      4,
      adaptationStrength
    );
    recommended.urgentDecisionFloor += scaledDelta(
      Math.min(
        3,
        (35 - avgUncertaintyAtFP) * 0.12
      ),
      3,
      adaptationStrength
    );
  }

  if (dominantFPCategory === "deadline_scheduling") {
    recommended.deadlineHighFloor += scaledDelta(4, 4, adaptationStrength);
  }

  if (
    dominantFPCategory === "sales_marketing" ||
    dominantFPCategory === "newsletter"
  ) {
    recommended.routineNoiseCap -= scaledDelta(
      Math.min(4, fps.length * 0.3),
      4,
      adaptationStrength
    );
  }

  if (promoNoiseConfirmed > 0) {
    const promoTightening = scaledDelta(
      Math.min(10, promoNoiseConfirmed * 2.6),
      10,
      adaptationStrength
    );
    recommended.promoSuppressionSensitivity += promoTightening;
    recommended.routineNoiseCap -= Math.max(1, Math.round(promoTightening * 0.45));
    recommended.surfaceAttentionFloor += Math.max(0, Math.round(promoTightening * 0.25));
  }

  if (protectedLaneMisses > 0) {
    const recoveryDelta = scaledDelta(
      Math.min(8, protectedLaneMisses * 2.2),
      8,
      adaptationStrength
    );
    recommended.mustNotMissFloor -= recoveryDelta;
    recommended.attentionHighFloor -= Math.max(1, Math.round(recoveryDelta * 0.5));
    recommended.attentionUrgentFloor -= Math.max(1, Math.round(recoveryDelta * 0.4));
    recommended.surfaceAttentionFloor -= Math.max(1, Math.round(recoveryDelta * 0.35));
    recommended.promoSuppressionSensitivity -= Math.max(
      1,
      Math.round(recoveryDelta * 0.4)
    );
  }

  if (urgentProtectedMisses > 0) {
    const urgentRecovery = scaledDelta(
      Math.min(6, urgentProtectedMisses * 2),
      6,
      adaptationStrength
    );
    recommended.attentionUrgentFloor -= urgentRecovery;
    recommended.mustNotMissFloor -= Math.max(1, Math.round(urgentRecovery * 0.5));
  }

  if (harmfulSeverityMisses > 0) {
    const securityRecovery = scaledDelta(
      Math.min(7, harmfulSeverityMisses * 2.4),
      7,
      adaptationStrength
    );
    recommended.securitySuspiciousFloor -= Math.max(
      1,
      Math.round(securityRecovery * 0.4)
    );
    recommended.securityHarmfulFloor -= securityRecovery;
    recommended.escalateSecurityFloor -= Math.max(
      1,
      Math.round(securityRecovery * 0.5)
    );
    recommended.riskHighMin -= Math.max(1, Math.round(securityRecovery * 0.4));
  }

  const harmfulFalsePositiveWeight = weightedSum(
    input.outcomeHistory,
    (entry) => entry.outcomeLabel === "harmful_false_positive",
    weightOf
  );
  if (harmfulFalsePositiveWeight > 0) {
    const securityTightening = scaledDelta(
      Math.min(6, harmfulFalsePositiveWeight * 2),
      6,
      adaptationStrength
    );
    recommended.securitySuspiciousFloor += Math.max(
      1,
      Math.round(securityTightening * 0.45)
    );
    recommended.securityHarmfulFloor += securityTightening;
    recommended.escalateSecurityFloor += Math.max(
      1,
      Math.round(securityTightening * 0.35)
    );
  }

  if (humanReviewBenignNoise > 0) {
    const reviewRelaxation = scaledDelta(
      Math.min(4, humanReviewBenignNoise * 1.6),
      4,
      adaptationStrength
    );
    recommended.autoTriageUncertaintyMax += Math.max(
      1,
      Math.round(reviewRelaxation * 0.6)
    );
    recommended.escalateUncertaintyMax += reviewRelaxation;
  }

  const clampedRecommended = clampRecommendation({
    ...recommended,
    autoTriageConfidenceMin: Math.round(recommended.autoTriageConfidenceMin),
    autoTriageUncertaintyMax: Math.round(recommended.autoTriageUncertaintyMax),
    escalateConfidenceMin: Math.round(recommended.escalateConfidenceMin),
    escalateUncertaintyMax: Math.round(recommended.escalateUncertaintyMax),
    riskMediumMin: Math.round(recommended.riskMediumMin),
    riskHighMin: Math.round(recommended.riskHighMin),
    harmfulPriorityFloor: Math.round(recommended.harmfulPriorityFloor),
    urgentDecisionFloor: Math.round(recommended.urgentDecisionFloor),
    deadlineHighFloor: Math.round(recommended.deadlineHighFloor),
    routineNoiseCap: Math.round(recommended.routineNoiseCap),
    attentionHighFloor: Math.round(recommended.attentionHighFloor),
    attentionUrgentFloor: Math.round(recommended.attentionUrgentFloor),
    securitySuspiciousFloor: Math.round(recommended.securitySuspiciousFloor),
    securityHarmfulFloor: Math.round(recommended.securityHarmfulFloor),
    surfaceAttentionFloor: Math.round(recommended.surfaceAttentionFloor),
    escalateSecurityFloor: Math.round(recommended.escalateSecurityFloor),
    promoSuppressionSensitivity: Math.round(
      recommended.promoSuppressionSensitivity
    ),
    mustNotMissFloor: Math.round(recommended.mustNotMissFloor),
  });

  recordAdjustment(
    adjustments,
    "autoTriageConfidenceMin",
    current.autoTriageConfidenceMin,
    clampedRecommended.autoTriageConfidenceMin,
    falsePositiveRate > 0.18
      ? "FP rate above 18% — raising confidence bar for auto-triage."
      : "FP rate below 6% with high accuracy — relaxing auto-triage.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "autoTriageUncertaintyMax",
    current.autoTriageUncertaintyMax,
    clampedRecommended.autoTriageUncertaintyMax,
    falsePositiveRate > 0.18
      ? "FP rate above 18% — lowering tolerated uncertainty for auto-triage."
      : "FP rate below 6% with high accuracy — relaxing the uncertainty ceiling for auto-triage.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "riskMediumMin",
    current.riskMediumMin,
    clampedRecommended.riskMediumMin,
    "FPs clustering in medium band — raising medium floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "riskHighMin",
    current.riskHighMin,
    clampedRecommended.riskHighMin,
    "Missed threats scoring below high threshold — lowering high floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "harmfulPriorityFloor",
    current.harmfulPriorityFloor,
    clampedRecommended.harmfulPriorityFloor,
    "Overconfident false positives are surfacing at low uncertainty — raising harmful action floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "urgentDecisionFloor",
    current.urgentDecisionFloor,
    clampedRecommended.urgentDecisionFloor,
    "Overconfident false positives suggest urgent-decision handling needs a higher bar.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "deadlineHighFloor",
    current.deadlineHighFloor,
    clampedRecommended.deadlineHighFloor,
    "Deadline emails are over-escalating — adjusting the deadline high floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "routineNoiseCap",
    current.routineNoiseCap,
    clampedRecommended.routineNoiseCap,
    "Promo/newsletter false positives are still leaking through — tightening the routine noise cap.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "attentionHighFloor",
    current.attentionHighFloor,
    clampedRecommended.attentionHighFloor,
    "Important benign mail is still being underscored — adjusting the high-attention floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "attentionUrgentFloor",
    current.attentionUrgentFloor,
    clampedRecommended.attentionUrgentFloor,
    "Must-not-miss urgent events are not surfacing fast enough — adjusting the urgent-attention floor.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "securitySuspiciousFloor",
    current.securitySuspiciousFloor,
    clampedRecommended.securitySuspiciousFloor,
    "Structured harmful outcomes are recalibrating when messages become suspicious enough to warn the user.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "securityHarmfulFloor",
    current.securityHarmfulFloor,
    clampedRecommended.securityHarmfulFloor,
    "Confirmed harmful outcomes are recalibrating when messages should cross into harmful severity.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "surfaceAttentionFloor",
    current.surfaceAttentionFloor,
    clampedRecommended.surfaceAttentionFloor,
    "User-relevant events and promo noise are shifting the surface-vs-suppress boundary.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "escalateSecurityFloor",
    current.escalateSecurityFloor,
    clampedRecommended.escalateSecurityFloor,
    "Structured harmful outcomes are calibrating when surfaced mail should escalate instead.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "promoSuppressionSensitivity",
    current.promoSuppressionSensitivity,
    clampedRecommended.promoSuppressionSensitivity,
    "Repeated low-value promo outcomes are tuning how aggressively Aegis suppresses commercial noise.",
    sampleSize
  );
  recordAdjustment(
    adjustments,
    "mustNotMissFloor",
    current.mustNotMissFloor,
    clampedRecommended.mustNotMissFloor,
    "Feedback on transactional, auth, and workflow mail is tuning the must-not-miss floor.",
    sampleSize
  );

  return {
    recommended: clampedRecommended,
    adjustments,
    diagnostics: {
      sampleSize,
      falsePositiveRate: Number(falsePositiveRate.toFixed(3)),
      falseNegativeRate: Number(falseNegativeRate.toFixed(3)),
      fpGuardEffectiveness: Number(fpGuardEffectiveness.toFixed(2)),
      avgUncertaintyAtFP: Number(avgUncertaintyAtFP.toFixed(2)),
      dominantFPCategory,
      effectiveSampleWeight: Number(weightedSampleSize.toFixed(2)),
      promoPressure: Number(promoPressure.toFixed(3)),
      protectedLaneMissRate: Number(protectedLaneMissRate.toFixed(3)),
      harmfulMissRate: Number(harmfulMissRate.toFixed(3)),
      recommendedFocus: buildRecommendedFocus({
        sampleSize,
        effectiveSampleWeight: weightedSampleSize,
        falsePositiveRate,
        falseNegativeRate,
        truePositiveRate,
        dominantFPCategory,
        fpGuardActivationRate,
        promoPressure,
        protectedLaneMissRate,
        harmfulMissRate,
      }),
    },
  };
}

/**
 * Returns the cache path used to persist adaptive threshold recommendations between scans.
 *
 * Pipeline step: adaptive-threshold cache persistence helper.
 * False-positive scenario addressed: keeps successful calibration available on the next scan without requiring model retraining.
 */
function getAdaptiveThresholdPath(dataDir: string): string {
  return path.join(dataDir, "inbox", "adaptive_thresholds.json");
}

/**
 * Parses a loaded JSON object into a safe adaptive-threshold result.
 *
 * Pipeline step: threshold-cache loading path.
 * False-positive scenario addressed: protects the scanner from corrupted threshold caches by coercing values back into safe rails.
 */
function sanitizeAdaptiveThresholdResult(
  raw: unknown
): AdaptiveThresholdResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<AdaptiveThresholdResult>;
  if (!value.recommended || !value.diagnostics) return null;

  const autoTriageConfidenceMin = finiteNumber(
    value.recommended.autoTriageConfidenceMin
  );
  const autoTriageUncertaintyMax = finiteNumber(
    value.recommended.autoTriageUncertaintyMax
  );
  const escalateConfidenceMin = finiteNumber(
    value.recommended.escalateConfidenceMin
  );
  const escalateUncertaintyMax = finiteNumber(
    value.recommended.escalateUncertaintyMax
  );
  const riskMediumMin = finiteNumber(value.recommended.riskMediumMin);
  const riskHighMin = finiteNumber(value.recommended.riskHighMin);
  const harmfulPriorityFloor = finiteNumber(
    value.recommended.harmfulPriorityFloor
  );
  const urgentDecisionFloor = finiteNumber(
    value.recommended.urgentDecisionFloor
  );
  const deadlineHighFloor = finiteNumber(value.recommended.deadlineHighFloor);
  const routineNoiseCap = finiteNumber(value.recommended.routineNoiseCap);
  const attentionHighFloor =
    finiteNumber(value.recommended.attentionHighFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.attentionHighFloor;
  const attentionUrgentFloor =
    finiteNumber(value.recommended.attentionUrgentFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.attentionUrgentFloor;
  const securitySuspiciousFloor =
    finiteNumber(value.recommended.securitySuspiciousFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.securitySuspiciousFloor;
  const securityHarmfulFloor =
    finiteNumber(value.recommended.securityHarmfulFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.securityHarmfulFloor;
  const surfaceAttentionFloor =
    finiteNumber(value.recommended.surfaceAttentionFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.surfaceAttentionFloor;
  const escalateSecurityFloor =
    finiteNumber(value.recommended.escalateSecurityFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.escalateSecurityFloor;
  const promoSuppressionSensitivity =
    finiteNumber(value.recommended.promoSuppressionSensitivity) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.promoSuppressionSensitivity;
  const mustNotMissFloor =
    finiteNumber(value.recommended.mustNotMissFloor) ??
    ADAPTIVE_THRESHOLD_DEFAULTS.mustNotMissFloor;

  if (
    autoTriageConfidenceMin === null ||
    autoTriageUncertaintyMax === null ||
    escalateConfidenceMin === null ||
    escalateUncertaintyMax === null ||
    riskMediumMin === null ||
    riskHighMin === null ||
    harmfulPriorityFloor === null ||
    urgentDecisionFloor === null ||
    deadlineHighFloor === null ||
    routineNoiseCap === null
  ) {
    return null;
  }

  const recommended = clampRecommendation({
    autoTriageConfidenceMin,
    autoTriageUncertaintyMax,
    escalateConfidenceMin,
    escalateUncertaintyMax,
    riskMediumMin,
    riskHighMin,
    harmfulPriorityFloor,
    urgentDecisionFloor,
    deadlineHighFloor,
    routineNoiseCap,
    attentionHighFloor,
    attentionUrgentFloor,
    securitySuspiciousFloor,
    securityHarmfulFloor,
    surfaceAttentionFloor,
    escalateSecurityFloor,
    promoSuppressionSensitivity,
    mustNotMissFloor,
  });

  const diagnostics = value.diagnostics;
  return {
    recommended,
    adjustments: Array.isArray(value.adjustments)
      ? value.adjustments
          .filter((entry): entry is AdaptiveThresholdResult["adjustments"][number] =>
            Boolean(
              entry &&
                typeof entry.threshold === "string" &&
                typeof entry.oldValue === "number" &&
                typeof entry.newValue === "number" &&
                (entry.direction === "tightened" || entry.direction === "relaxed") &&
                typeof entry.reason === "string" &&
                typeof entry.confidence === "number"
            )
          )
      : [],
    diagnostics: {
      sampleSize: Number(diagnostics.sampleSize) || 0,
      falsePositiveRate: Number(diagnostics.falsePositiveRate) || 0,
      falseNegativeRate: Number(diagnostics.falseNegativeRate) || 0,
      fpGuardEffectiveness: Number(diagnostics.fpGuardEffectiveness) || 0,
      avgUncertaintyAtFP: Number(diagnostics.avgUncertaintyAtFP) || 0,
      dominantFPCategory:
        typeof diagnostics.dominantFPCategory === "string"
          ? diagnostics.dominantFPCategory
          : "none",
      effectiveSampleWeight: Number(diagnostics.effectiveSampleWeight) || 0,
      promoPressure: Number(diagnostics.promoPressure) || 0,
      protectedLaneMissRate: Number(diagnostics.protectedLaneMissRate) || 0,
      harmfulMissRate: Number(diagnostics.harmfulMissRate) || 0,
      recommendedFocus:
        typeof diagnostics.recommendedFocus === "string"
          ? diagnostics.recommendedFocus
          : "Adaptive threshold cache loaded.",
    },
  };
}

/**
 * Loads the cached adaptive threshold recommendation from disk, returning null when the cache is missing or invalid.
 *
 * Pipeline step: startup calibration load before a new inbox scan begins.
 * False-positive scenario addressed: reuses prior self-tuning output without letting missing or corrupted cache state break the scanner.
 */
export async function loadAdaptiveThresholds(
  dataDir: string
): Promise<AdaptiveThresholdResult | null> {
  try {
    const raw = await fs.readFile(getAdaptiveThresholdPath(dataDir), "utf8");
    return sanitizeAdaptiveThresholdResult(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Saves the latest adaptive threshold recommendation to disk for the next scan cycle.
 *
 * Pipeline step: end-of-scan adaptive-threshold persistence.
 * False-positive scenario addressed: makes successful calibration cumulative instead of recalculating from scratch on every startup.
 */
export async function saveAdaptiveThresholds(
  dataDir: string,
  result: AdaptiveThresholdResult
): Promise<void> {
  try {
    const target = getAdaptiveThresholdPath(dataDir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(result, null, 2), "utf8");
  } catch {
    // Swallow persistence errors so scanner execution never fails on cache writes.
  }
}
