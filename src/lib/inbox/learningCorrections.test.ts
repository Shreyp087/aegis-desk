import assert from "node:assert/strict";
import test from "node:test";

import { applyLearningCorrections } from "./learningCorrections";
import type { IncidentHint } from "./classifier";

function buildBaseProfile() {
  return {
    threatScore: 18,
    urgencyScore: 28,
    relevanceScore: 32,
    opportunityScore: 16,
    noiseScore: 48,
    trustGapScore: 14,
    affinityScore: 22,
    attentionType: "review_later" as const,
    rationale: "base",
  };
}

function buildHint(
  overrides: Partial<IncidentHint> & Pick<IncidentHint, "mailClass" | "threatType" | "trustedAction" | "priorityScore" | "outcomeLabel">
): IncidentHint {
  return {
    primaryCategory: "general",
    ...overrides,
  };
}

test("Temu-style promo history increases promo fatigue suppression", () => {
  const result = applyLearningCorrections({
    primaryCategory: "sales_marketing",
    decisionImportance: buildBaseProfile(),
    eventContext: {
      primaryEventType: "promotional_commerce",
      secondaryTags: ["bulk_marketing"],
      confidence: 88,
      sensitiveEvent: {
        detected: false,
        family: null,
        confidence: 0,
        attentionBoost: 0,
        securityBoost: 0,
        mustNotMissScore: 0,
        timeSensitivity: "low",
        routeHint: null,
        rationale: "none",
        guardrails: [],
      },
    },
    incidentHints: [
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 22,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "informational",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 28,
        outcomeLabel: "informational_correct",
      }),
      buildHint({
        primaryCategory: "newsletter",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 20,
        outcomeLabel: "spam_true_positive",
      }),
    ],
    promotional: {
      lowRiskPromotional: true,
      promotionalConfidence: 3.4,
      promoUrgencyHits: 2,
      senderPromoHints: 3,
    },
    trust: {
      score: 68,
      seen: 9,
      highCount: 1,
      mediumCount: 1,
    },
  });

  assert.equal(result.correctionMode, "promo_fatigue");
  assert.ok(result.ruleHits.includes("learning_promo_fatigue"));
  assert.ok(result.adjustedProfile.noiseScore > 48);
  assert.ok(result.adjustedProfile.relevanceScore < 32);
});

test("real purchase receipt is protected from promo-history suppression", () => {
  const result = applyLearningCorrections({
    primaryCategory: "finance_payment",
    decisionImportance: buildBaseProfile(),
    eventContext: {
      primaryEventType: "purchase_confirmed",
      secondaryTags: ["receipt_invoice"],
      confidence: 92,
      sensitiveEvent: {
        detected: true,
        family: "commerce_transaction",
        confidence: 91,
        attentionBoost: 16,
        securityBoost: 0,
        mustNotMissScore: 84,
        timeSensitivity: "medium",
        routeHint: "surface",
        rationale: "transactional",
        guardrails: [],
      },
    },
    incidentHints: [
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 20,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "newsletter",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 24,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "finance_payment",
        mailClass: "actionable",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 74,
        outcomeLabel: "actionable_correct",
      }),
    ],
    promotional: {
      lowRiskPromotional: false,
      promotionalConfidence: 0.4,
      promoUrgencyHits: 0,
      senderPromoHints: 0,
    },
    trust: {
      score: 74,
      seen: 10,
      highCount: 2,
      mediumCount: 2,
    },
  });

  assert.ok(result.ruleHits.includes("learning_transactional_protection"));
  assert.ok(result.adjustedProfile.noiseScore < 48);
  assert.ok(result.adjustedProfile.relevanceScore > 32);
});

test("suspicious fake receipt keeps threat reinforcement instead of transactional protection", () => {
  const result = applyLearningCorrections({
    primaryCategory: "scam_invoice_fraud",
    decisionImportance: {
      ...buildBaseProfile(),
      threatScore: 62,
      noiseScore: 22,
    },
    eventContext: {
      primaryEventType: "phishing_or_impersonation",
      secondaryTags: ["receipt_invoice"],
      confidence: 94,
      sensitiveEvent: {
        detected: false,
        family: null,
        confidence: 0,
        attentionBoost: 0,
        securityBoost: 0,
        mustNotMissScore: 0,
        timeSensitivity: "low",
        routeHint: null,
        rationale: "none",
        guardrails: [],
      },
    },
    incidentHints: [
      buildHint({
        primaryCategory: "scam_invoice_fraud",
        mailClass: "harmful",
        threatType: "payment_fraud",
        trustedAction: "quarantine",
        priorityScore: 86,
        outcomeLabel: "harmful_true_positive",
      }),
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 20,
        outcomeLabel: "spam_true_positive",
      }),
    ],
    promotional: {
      lowRiskPromotional: false,
      promotionalConfidence: 0,
      promoUrgencyHits: 0,
      senderPromoHints: 0,
    },
    trust: {
      score: 42,
      seen: 4,
      highCount: 1,
      mediumCount: 0,
    },
  });

  assert.ok(result.ruleHits.includes("learning_harmful_reinforcement"));
  assert.ok(!result.ruleHits.includes("learning_transactional_protection"));
  assert.ok(result.adjustedProfile.threatScore > 62);
});

test("password reset from a promo-heavy provider family still gets protected", () => {
  const result = applyLearningCorrections({
    primaryCategory: "security_phishing",
    decisionImportance: buildBaseProfile(),
    eventContext: {
      primaryEventType: "password_reset",
      secondaryTags: ["account_recovery"],
      confidence: 90,
      sensitiveEvent: {
        detected: true,
        family: "account_recovery",
        confidence: 92,
        attentionBoost: 20,
        securityBoost: 8,
        mustNotMissScore: 86,
        timeSensitivity: "high",
        routeHint: "surface",
        rationale: "account recovery",
        guardrails: [],
      },
    },
    incidentHints: [
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 18,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "newsletter",
        mailClass: "spam",
        threatType: "none",
        trustedAction: "allow",
        priorityScore: 24,
        outcomeLabel: "spam_true_positive",
      }),
    ],
    promotional: {
      lowRiskPromotional: false,
      promotionalConfidence: 0.2,
      promoUrgencyHits: 0,
      senderPromoHints: 0,
    },
    trust: {
      score: 70,
      seen: 7,
      highCount: 1,
      mediumCount: 2,
    },
  });

  assert.ok(result.ruleHits.includes("learning_transactional_protection"));
  assert.ok(result.adjustedProfile.urgencyScore > 28);
});
