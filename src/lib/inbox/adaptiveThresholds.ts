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
};

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
  falsePositiveRate: number;
  falseNegativeRate: number;
  truePositiveRate: number;
  dominantFPCategory: string;
  fpGuardActivationRate: number;
}): string {
  if (args.sampleSize === 0) {
    return "No labeled outcome history is available yet, so the scanner is still operating on static defaults.";
  }
  if (args.sampleSize < 12) {
    return "More labeled outcomes are needed before adaptive calibration should move thresholds.";
  }
  if (args.fpGuardActivationRate < 0.08) {
    return "Consider lowering FP Guard rule thresholds — guard is underactivating relative to observed false positives.";
  }
  if (args.fpGuardActivationRate > 0.55) {
    return "FP Guard activating on majority of emails — review rule sensitivity before tightening more thresholds.";
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

  if (sampleSize < input.minSampleSize) {
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
        recommendedFocus: buildRecommendedFocus({
          sampleSize,
          falsePositiveRate,
          falseNegativeRate,
          truePositiveRate,
          dominantFPCategory,
          fpGuardActivationRate,
        }),
      },
    };
  }

  const recommended: AdaptiveThresholdRecommendation = { ...current };

  if (falsePositiveRate > 0.18) {
    recommended.autoTriageConfidenceMin += Math.min(
      6,
      (falsePositiveRate - 0.18) * 40
    );
    recommended.autoTriageUncertaintyMax -= Math.min(
      5,
      (falsePositiveRate - 0.18) * 30
    );
  } else if (
    falsePositiveRate < 0.06 &&
    sampleSize > 0 &&
    correct.length / sampleSize > 0.72
  ) {
    recommended.autoTriageConfidenceMin -= Math.min(
      4,
      (0.06 - falsePositiveRate) * 30
    );
    recommended.autoTriageUncertaintyMax += Math.min(
      3,
      (0.06 - falsePositiveRate) * 20
    );
  }

  if (avgPriorityScoreAtFP >= 50 && avgPriorityScoreAtFP < 80) {
    recommended.riskMediumMin += Math.min(
      5,
      (avgPriorityScoreAtFP - 50) * 0.2
    );
  }

  if (fns.length > 0 && avgPriorityScoreAtFN < current.riskHighMin) {
    recommended.riskHighMin -= Math.min(
      6,
      (current.riskHighMin - avgPriorityScoreAtFN) * 0.3
    );
  }

  if (fps.length > 0 && avgUncertaintyAtFP < 35) {
    recommended.harmfulPriorityFloor += Math.min(
      4,
      (35 - avgUncertaintyAtFP) * 0.15
    );
    recommended.urgentDecisionFloor += Math.min(
      3,
      (35 - avgUncertaintyAtFP) * 0.12
    );
  }

  if (dominantFPCategory === "deadline_scheduling") {
    recommended.deadlineHighFloor += 4;
  }

  if (
    dominantFPCategory === "sales_marketing" ||
    dominantFPCategory === "newsletter"
  ) {
    recommended.routineNoiseCap -= Math.min(4, fps.length * 0.3);
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
      recommendedFocus: buildRecommendedFocus({
        sampleSize,
        falsePositiveRate,
        falseNegativeRate,
        truePositiveRate,
        dominantFPCategory,
        fpGuardActivationRate,
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
