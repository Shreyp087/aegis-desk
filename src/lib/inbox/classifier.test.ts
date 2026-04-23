import assert from "node:assert/strict";
import test from "node:test";

import { classifyInboxMail, type IncidentHint } from "./classifier";

function buildHint(overrides: Partial<IncidentHint> = {}): IncidentHint {
  return {
    mailClass: "informational",
    threatType: "none",
    trustedAction: "allow",
    priorityScore: 30,
    outcomeLabel: "",
    primaryCategory: "general",
    ...overrides,
  };
}

function classifyWith(args: {
  primaryCategory: string;
  incidentHints: IncidentHint[];
}) {
  return classifyInboxMail({
    primaryCategory: args.primaryCategory,
    categoryScores: [
      { category: args.primaryCategory, score: 52 },
      { category: "general", score: 18 },
      { category: "sales_marketing", score: args.primaryCategory === "sales_marketing" ? 52 : 10 },
      { category: "newsletter", score: args.primaryCategory === "newsletter" ? 48 : 8 },
      { category: "finance_payment", score: args.primaryCategory === "finance_payment" ? 56 : 12 },
      { category: "security_phishing", score: args.primaryCategory === "security_phishing" ? 50 : 10 },
      { category: "legal_contract", score: 8 },
      { category: "deadline_scheduling", score: 10 },
      { category: "ops_support", score: 14 },
      { category: "scam_bec", score: 4 },
      { category: "scam_invoice_fraud", score: 6 },
      { category: "scam_credential_phishing", score: 4 },
      { category: "scam_malware_attachment", score: 2 },
      { category: "scam_impersonation", score: 2 },
      { category: "executive_escalation", score: 6 },
    ],
    riskTags: [],
    signals: ["test"],
    trustScore: 66,
    reputationScore: 74,
    threadDepth: 1,
    threadRiskDensity: 0,
    attachmentRiskScore: 0,
    urlsCount: 1,
    moneyMentionsCount: args.primaryCategory === "finance_payment" ? 1 : 0,
    deadlineCount: 0,
    incidentHints: args.incidentHints,
    decisionImportance: {
      threatScore: args.primaryCategory === "finance_payment" ? 18 : 10,
      urgencyScore: 32,
      relevanceScore: args.primaryCategory === "finance_payment" ? 54 : 24,
      opportunityScore: 10,
      noiseScore: args.primaryCategory === "sales_marketing" ? 72 : 20,
      trustGapScore: 16,
      affinityScore: 22,
      attentionType: "review_later",
      rationale: "test",
    },
  });
}

test("promo history stays in the promo lane instead of poisoning other categories", () => {
  const result = classifyWith({
    primaryCategory: "sales_marketing",
    incidentHints: [
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        priorityScore: 22,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "informational",
        priorityScore: 28,
        outcomeLabel: "informational_correct",
      }),
      buildHint({
        primaryCategory: "newsletter",
        mailClass: "spam",
        priorityScore: 20,
        outcomeLabel: "spam_true_positive",
      }),
    ],
  });

  assert.ok(result.probabilities.spam > result.probabilities.actionable);
});

test("transactional finance mail is protected from promo history by same-category learning", () => {
  const result = classifyWith({
    primaryCategory: "finance_payment",
    incidentHints: [
      buildHint({
        primaryCategory: "sales_marketing",
        mailClass: "spam",
        priorityScore: 20,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "newsletter",
        mailClass: "spam",
        priorityScore: 18,
        outcomeLabel: "spam_true_positive",
      }),
      buildHint({
        primaryCategory: "finance_payment",
        mailClass: "actionable",
        priorityScore: 74,
        outcomeLabel: "actionable_correct",
      }),
      buildHint({
        primaryCategory: "finance_payment",
        mailClass: "informational",
        priorityScore: 60,
        outcomeLabel: "spam_false_positive",
      }),
    ],
  });

  assert.ok(result.probabilities.spam < result.probabilities.actionable);
  assert.notEqual(result.predictedClass, "spam");
});
