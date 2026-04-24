import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAdaptiveThresholds,
  type AdaptiveThresholdInput,
  type AdaptiveThresholdRecommendation,
} from "./adaptiveThresholds";

function buildDefaults(): AdaptiveThresholdRecommendation {
  return {
    autoTriageConfidenceMin: 82,
    autoTriageUncertaintyMax: 28,
    escalateConfidenceMin: 60,
    escalateUncertaintyMax: 52,
    riskMediumMin: 40,
    riskHighMin: 70,
    harmfulPriorityFloor: 84,
    urgentDecisionFloor: 80,
    deadlineHighFloor: 80,
    routineNoiseCap: 36,
    attentionHighFloor: 75,
    attentionUrgentFloor: 88,
    securitySuspiciousFloor: 40,
    securityHarmfulFloor: 70,
    surfaceAttentionFloor: 58,
    escalateSecurityFloor: 72,
    promoSuppressionSensitivity: 50,
    mustNotMissFloor: 80,
  };
}

function buildEntry(
  overrides: Partial<AdaptiveThresholdInput["outcomeHistory"][number]> = {}
): AdaptiveThresholdInput["outcomeHistory"][number] {
  return {
    priorityScore: 24,
    priorityBand: "low",
    outcomeLabel: "spam_true_positive",
    mailClass: "spam",
    primaryCategory: "sales_marketing",
    fpGuardActivated: true,
    fpGuardDelta: 18,
    consensusScore: 22,
    uncertainty: 18,
    timestamp: new Date("2026-04-22T12:00:00.000Z"),
    routingAction: "auto_triage",
    attentionPriority: "low",
    securitySeverity: "noisy",
    actionRoute: "suppress",
    ...overrides,
  };
}

test("promo-heavy false positives tighten promo suppression faster after warm start", () => {
  const outcomeHistory = Array.from({ length: 8 }, (_, index) =>
    buildEntry({
      timestamp: new Date(`2026-04-${23 - index}T12:00:00.000Z`),
      primaryCategory: index % 2 === 0 ? "sales_marketing" : "newsletter",
      outcomeLabel: "spam_true_positive",
      actionRoute: "surface",
      attentionPriority: "medium",
      securitySeverity: "noisy",
      priorityScore: 34,
      priorityBand: "low",
    })
  );

  const result = computeAdaptiveThresholds({
    outcomeHistory,
    currentThresholds: buildDefaults(),
    minSampleSize: 12,
  });

  assert.ok(result.recommended.promoSuppressionSensitivity > 50);
  assert.ok(result.recommended.routineNoiseCap < 36);
  assert.ok(result.adjustments.some((entry) => entry.threshold === "promoSuppressionSensitivity"));
  assert.ok(
    /promo/i.test(result.diagnostics.recommendedFocus) ||
      /FP Guard/i.test(result.diagnostics.recommendedFocus)
  );
});

test("important benign protected-lane misses lower must-not-miss and attention floors", () => {
  const outcomeHistory = Array.from({ length: 9 }, (_, index) =>
    buildEntry({
      timestamp: new Date(`2026-04-${23 - index}T08:00:00.000Z`),
      primaryCategory: index % 2 === 0 ? "ops_support" : "finance_payment",
      outcomeLabel: "actionable_correct",
      mailClass: "actionable",
      priorityScore: 82,
      priorityBand: "high",
      fpGuardActivated: false,
      fpGuardDelta: 0,
      consensusScore: 64,
      uncertainty: 26,
      routingAction: "human_review",
      attentionPriority: "low",
      securitySeverity: "benign",
      actionRoute: "suppress",
    })
  );

  const result = computeAdaptiveThresholds({
    outcomeHistory,
    currentThresholds: buildDefaults(),
    minSampleSize: 12,
  });

  assert.ok(result.recommended.mustNotMissFloor < 80);
  assert.ok(result.recommended.attentionHighFloor < 75);
  assert.ok(result.recommended.surfaceAttentionFloor < 58);
  assert.ok(result.diagnostics.protectedLaneMissRate > 0);
});

test("missed harmful outcomes lower harmful and escalation floors", () => {
  const outcomeHistory = Array.from({ length: 10 }, (_, index) =>
    buildEntry({
      timestamp: new Date(`2026-04-${23 - index}T06:00:00.000Z`),
      primaryCategory: "security_phishing",
      outcomeLabel: "harmful_true_positive",
      mailClass: "harmful",
      priorityScore: 58,
      priorityBand: "medium",
      fpGuardActivated: false,
      fpGuardDelta: 0,
      consensusScore: 54,
      uncertainty: 22,
      routingAction: "auto_triage",
      attentionPriority: "medium",
      securitySeverity: "suspicious",
      actionRoute: "surface",
    })
  );

  const result = computeAdaptiveThresholds({
    outcomeHistory,
    currentThresholds: buildDefaults(),
    minSampleSize: 12,
  });

  assert.ok(result.recommended.securityHarmfulFloor < 70);
  assert.ok(result.recommended.escalateSecurityFloor < 72);
  assert.ok(result.recommended.riskHighMin < 70);
  assert.ok(result.diagnostics.harmfulMissRate > 0);
});

test("warm-start guard prevents overfitting after too few samples", () => {
  const outcomeHistory = Array.from({ length: 5 }, (_, index) =>
    buildEntry({
      timestamp: new Date(`2026-04-${23 - index}T12:00:00.000Z`),
    })
  );

  const defaults = buildDefaults();
  const result = computeAdaptiveThresholds({
    outcomeHistory,
    currentThresholds: defaults,
    minSampleSize: 12,
  });

  assert.deepEqual(result.recommended, defaults);
  assert.equal(result.adjustments.length, 0);
  assert.match(result.diagnostics.recommendedFocus, /More labeled outcomes/i);
});
