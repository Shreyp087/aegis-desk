import assert from "node:assert/strict";
import test from "node:test";

import { applyFalsePositiveGuard } from "./falsePositiveGuard";

function buildInput(outcomeLabels: string[]) {
  return {
    rawPriorityScore: 58,
    priorityBand: "medium" as const,
    primaryCategory: "sales_marketing",
    categoryScores: {
      sales_marketing: 28,
      newsletter: 14,
      general: 12,
    },
    riskTags: [],
    signals: ["newsletter/marketing signature detected"],
    decisionProfile: {
      threat: 20,
      urgency: 24,
      relevance: 36,
      opportunity: 18,
      noise: 70,
      trustGap: 12,
      affinity: 8,
      attentionType: "review_later",
    },
    email: {
      receivedAt: new Date("2026-04-23T10:00:00Z"),
      senderEmail: "promo@example.com",
      senderDomain: "example.com",
      deadlines: [],
      moneyMentions: [],
      attachmentRiskScore: 0,
      urlCount: 1,
      threadDepth: 1,
      body: "Weekly deals and product updates.",
    },
    trust: {
      senderScore: 52,
      domainScore: 50,
      seen: 5,
      highCount: 1,
      mediumCount: 1,
      lastSeen: new Date("2026-04-21T10:00:00Z"),
    },
    history: {
      outcomeLabels,
      priorPriorityScores: [28, 32, 30],
      memorySampleCount: outcomeLabels.length,
    },
    promotional: {
      lowRiskPromotional: true,
      promotionalConfidence: 2.6,
      promoUrgencyHits: 1,
      senderPromoHints: 2,
    },
    classifier: {
      spamProbability: 0.42,
      harmfulProbability: 0.08,
      actionableProbability: 0.18,
      informationalProbability: 0.32,
    },
  };
}

test("spam_false_positive history no longer triggers feedback decay suppression", () => {
  const result = applyFalsePositiveGuard(
    buildInput(["spam_false_positive", "harmful_false_positive", "actionable_correct"])
  );

  assert.ok(
    !result.corrections.some(
      (correction) => correction.rule === "feedback_memory_decay_correction"
    )
  );
});

test("confirmed low-value spam history still triggers feedback decay suppression", () => {
  const result = applyFalsePositiveGuard(
    buildInput(["spam_true_positive", "spam_true_positive", "informational_correct"])
  );

  assert.ok(
    result.corrections.some(
      (correction) => correction.rule === "feedback_memory_decay_correction"
    )
  );
});
