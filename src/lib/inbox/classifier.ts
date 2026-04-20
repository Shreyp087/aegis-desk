import type { InboxMailClass, InboxThreatType } from "./schemas";
import type { DecisionImportanceProfile } from "./importance";

export type IncidentHint = {
  mailClass: InboxMailClass;
  threatType: InboxThreatType;
  trustedAction: "allow" | "escalate" | "quarantine" | "block";
  priorityScore: number;
  outcomeLabel: string;
};

export type MailClassifierInput = {
  primaryCategory: string;
  categoryScores: Array<{ category: string; score: number }>;
  riskTags: string[];
  signals: string[];
  trustScore: number;
  reputationScore: number;
  threadDepth: number;
  threadRiskDensity: number;
  attachmentRiskScore: number;
  urlsCount: number;
  moneyMentionsCount: number;
  deadlineCount: number;
  incidentHints: IncidentHint[];
  decisionImportance: DecisionImportanceProfile;
};

export type MailClassifierResult = {
  probabilities: {
    spam: number;
    harmful: number;
    actionable: number;
    informational: number;
  };
  predictedClass: InboxMailClass;
  memorySampleCount: number;
  rationale: string;
  modelVersion: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function scoreOfCategory(
  categoryScores: Array<{ category: string; score: number }>,
  category: string
): number {
  return categoryScores.find((entry) => entry.category === category)?.score ?? 0;
}

function normalizeProbabilities(args: {
  spam: number;
  harmful: number;
  actionable: number;
  informational: number;
}): MailClassifierResult["probabilities"] {
  const sum = args.spam + args.harmful + args.actionable + args.informational;
  if (sum <= 0) {
    return {
      spam: 0.25,
      harmful: 0.25,
      actionable: 0.25,
      informational: 0.25,
    };
  }
  return {
    spam: clamp(args.spam / sum, 0, 1),
    harmful: clamp(args.harmful / sum, 0, 1),
    actionable: clamp(args.actionable / sum, 0, 1),
    informational: clamp(args.informational / sum, 0, 1),
  };
}

export function classifyInboxMail(input: MailClassifierInput): MailClassifierResult {
  const newsletterScore = scoreOfCategory(input.categoryScores, "newsletter");
  const salesScore = scoreOfCategory(input.categoryScores, "sales_marketing");
  const securityScore = scoreOfCategory(input.categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(input.categoryScores, "finance_payment");
  const legalScore = scoreOfCategory(input.categoryScores, "legal_contract");
  const deadlineScore = scoreOfCategory(input.categoryScores, "deadline_scheduling");
  const supportScore = scoreOfCategory(input.categoryScores, "ops_support");
  const scamPeak = Math.max(
    scoreOfCategory(input.categoryScores, "scam_bec"),
    scoreOfCategory(input.categoryScores, "scam_invoice_fraud"),
    scoreOfCategory(input.categoryScores, "scam_credential_phishing"),
    scoreOfCategory(input.categoryScores, "scam_malware_attachment"),
    scoreOfCategory(input.categoryScores, "scam_impersonation")
  );

  const learnedHints = input.incidentHints.filter((hint) => Boolean(hint.outcomeLabel));
  const memoryCount = learnedHints.length;
  const spamHistory =
    memoryCount === 0
      ? 0
      : learnedHints.filter((h) => h.mailClass === "spam").length / memoryCount;
  const harmfulHistory =
    memoryCount === 0
      ? 0
      : learnedHints.filter((h) => h.mailClass === "harmful").length / memoryCount;
  const falsePositivePressure =
    memoryCount === 0
      ? 0
      : learnedHints.filter((h) => h.outcomeLabel === "spam_false_positive").length / memoryCount;
  const safeAffinity =
    memoryCount === 0
      ? 0
      : learnedHints.filter(
          (h) =>
            h.outcomeLabel === "actionable_correct" ||
            h.outcomeLabel === "informational_correct" ||
            h.outcomeLabel === "spam_false_positive"
        ).length / memoryCount;
  const confirmedSpam =
    memoryCount === 0
      ? 0
      : learnedHints.filter((h) => h.outcomeLabel === "spam_true_positive").length / memoryCount;
  const confirmedHarmful =
    memoryCount === 0
      ? 0
      : learnedHints.filter((h) => h.outcomeLabel === "harmful_true_positive").length / memoryCount;

  const spamLogit =
    -0.5 +
    newsletterScore * 0.045 +
    salesScore * 0.012 -
    securityScore * 0.025 -
    financeScore * 0.018 -
    scamPeak * 0.02 +
    input.decisionImportance.noiseScore * 0.018 -
    input.decisionImportance.opportunityScore * 0.015 -
    input.decisionImportance.relevanceScore * 0.01 +
    spamHistory * 0.9 +
    confirmedSpam * 0.95 -
    falsePositivePressure * 1.25 -
    safeAffinity * 1.05;

  const harmfulLogit =
    -1.0 +
    scamPeak * 0.046 +
    securityScore * 0.025 +
    financeScore * 0.021 +
    input.decisionImportance.threatScore * 0.018 +
    input.decisionImportance.trustGapScore * 0.012 +
    (input.attachmentRiskScore / 100) * 1.1 +
    Math.min(0.9, input.urlsCount * 0.1) +
    (input.trustScore <= 35 ? 0.45 : 0) +
    (input.reputationScore <= 40 ? 0.35 : 0) +
    input.threadRiskDensity * 0.55 +
    harmfulHistory * 1.3 +
    confirmedHarmful * 1.1 -
    safeAffinity * 0.25;

  const actionableLogit =
    -0.85 +
    deadlineScore * 0.02 +
    supportScore * 0.02 +
    legalScore * 0.015 +
    input.decisionImportance.urgencyScore * 0.02 +
    input.decisionImportance.relevanceScore * 0.017 +
    input.decisionImportance.opportunityScore * 0.008 +
    Math.min(0.8, input.deadlineCount * 0.15) +
    Math.min(0.6, input.moneyMentionsCount * 0.12) +
    (input.threadDepth >= 2 ? 0.2 : 0) +
    safeAffinity * 0.35;

  const informationalLogit =
    -0.25 +
    (input.primaryCategory === "general" ? 0.45 : 0) +
    (input.signals.length <= 1 ? 0.35 : 0) +
    (input.riskTags.length === 0 ? 0.35 : 0) +
    (input.threadDepth <= 1 ? 0.2 : 0) +
    input.decisionImportance.noiseScore * 0.014 +
    input.decisionImportance.opportunityScore * 0.01 +
    safeAffinity * 0.25 -
    input.decisionImportance.threatScore * 0.01 -
    input.decisionImportance.urgencyScore * 0.012;

  const normalized = normalizeProbabilities({
    spam: sigmoid(spamLogit),
    harmful: sigmoid(harmfulLogit),
    actionable: sigmoid(actionableLogit),
    informational: sigmoid(informationalLogit),
  });

  const ordered: Array<{ key: InboxMailClass; value: number }> = [
    { key: "spam", value: normalized.spam },
    { key: "harmful", value: normalized.harmful },
    { key: "actionable", value: normalized.actionable },
    { key: "informational", value: normalized.informational },
  ];
  ordered.sort((a, b) => b.value - a.value);

  let predictedClass: InboxMailClass = ordered[0]?.key || "informational";
  if (normalized.harmful >= 0.66) predictedClass = "harmful";
  if (normalized.spam >= 0.6 && normalized.harmful < 0.5) predictedClass = "spam";

  const rationale = `probs spam=${Math.round(normalized.spam * 100)} harmful=${Math.round(
    normalized.harmful * 100
  )} actionable=${Math.round(normalized.actionable * 100)} informational=${Math.round(
    normalized.informational * 100
  )}; memory=${memoryCount} hints`;

  return {
    probabilities: normalized,
    predictedClass,
    memorySampleCount: memoryCount,
    rationale,
    modelVersion: "inbox-hybrid-classifier-v2",
  };
}
