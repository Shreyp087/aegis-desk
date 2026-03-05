import type { MailClassifierResult } from "./classifier";
import type { InboxMailClass, InboxThreatType } from "./schemas";

export type InboxPriority = "high" | "medium" | "low";
export type TrustedDecisionAction = "allow" | "escalate" | "quarantine" | "block";

export type PriorityGuardrailInput = {
  primaryCategory: string;
  categoryScores: Array<{ category: string; score: number }>;
  priorityScore: number;
  signals: string[];
  trustScore: number;
  reputationScore: number;
  attachmentRiskScore: number;
  urlsCount: number;
  classifier: MailClassifierResult;
};

export type PriorityGuardrailResult = {
  priorityScore: number;
  priority: InboxPriority;
  adjusted: boolean;
  ruleHits: string[];
  rationale: string;
};

export type ActionGuardrailInput = {
  currentAction: TrustedDecisionAction;
  primaryCategory: string;
  categoryScores: Array<{ category: string; score: number }>;
  attachmentRiskScore: number;
  urlsCount: number;
  classifier: MailClassifierResult;
};

export type ActionGuardrailResult = {
  action: TrustedDecisionAction;
  adjusted: boolean;
  ruleHits: string[];
  note: string;
};

export type MailClassReconcileInput = {
  primaryCategory: string;
  derivedMailClass: InboxMailClass;
  derivedThreatType: InboxThreatType;
  classifier: MailClassifierResult;
};

export type MailClassReconcileResult = {
  mailClass: InboxMailClass;
  threatType: InboxThreatType;
  adjusted: boolean;
  ruleHits: string[];
  rationale: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreOfCategory(
  categoryScores: Array<{ category: string; score: number }>,
  category: string
): number {
  return categoryScores.find((entry) => entry.category === category)?.score ?? 0;
}

function priorityFromScore(score: number): InboxPriority {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function applyPriorityGuardrails(
  input: PriorityGuardrailInput
): PriorityGuardrailResult {
  const newsletterScore = scoreOfCategory(input.categoryScores, "newsletter");
  const salesScore = scoreOfCategory(input.categoryScores, "sales_marketing");
  const securityScore = scoreOfCategory(input.categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(input.categoryScores, "finance_payment");
  const scamPeak = Math.max(
    scoreOfCategory(input.categoryScores, "scam_bec"),
    scoreOfCategory(input.categoryScores, "scam_invoice_fraud"),
    scoreOfCategory(input.categoryScores, "scam_credential_phishing"),
    scoreOfCategory(input.categoryScores, "scam_malware_attachment"),
    scoreOfCategory(input.categoryScores, "scam_impersonation")
  );

  const riskyEvidence =
    scamPeak >= 58 ||
    securityScore >= 58 ||
    financeScore >= 62 ||
    input.attachmentRiskScore >= 40 ||
    input.urlsCount >= 5 ||
    input.trustScore <= 30 ||
    input.reputationScore <= 35;

  let adjusted = input.priorityScore;
  const ruleHits: string[] = [];
  const probs = input.classifier.probabilities;

  const looksPromotional =
    input.primaryCategory === "newsletter" ||
    input.primaryCategory === "sales_marketing" ||
    newsletterScore >= 35 ||
    salesScore >= 45;

  if (
    looksPromotional &&
    probs.spam >= 0.58 &&
    probs.harmful < 0.46 &&
    !riskyEvidence
  ) {
    adjusted = Math.min(adjusted, 36);
    ruleHits.push("spam_promotional_low_cap");
  }

  if (
    probs.spam >= 0.66 &&
    probs.harmful < 0.45 &&
    !riskyEvidence &&
    input.signals.length <= 2
  ) {
    adjusted = Math.min(adjusted, 46);
    ruleHits.push("spam_low_signal_cap");
  }

  if (
    probs.harmful >= 0.74 &&
    (riskyEvidence || scamPeak >= 65 || input.attachmentRiskScore >= 48)
  ) {
    adjusted = Math.max(adjusted, 84);
    ruleHits.push("harmful_priority_floor");
  }

  if (input.classifier.memorySampleCount >= 3 && probs.spam >= 0.62 && !riskyEvidence) {
    adjusted = Math.min(adjusted, 42);
    ruleHits.push("memory_spam_cap");
  }

  adjusted = clamp(Math.round(adjusted), 0, 100);
  const priority = priorityFromScore(adjusted);

  return {
    priorityScore: adjusted,
    priority,
    adjusted: adjusted !== input.priorityScore,
    ruleHits,
    rationale:
      ruleHits.length > 0
        ? `Applied ${ruleHits.join(", ")} with spam=${Math.round(
            probs.spam * 100
          )}% harmful=${Math.round(probs.harmful * 100)}%.`
        : "No priority guardrail adjustments applied.",
  };
}

export function applyActionGuardrails(
  input: ActionGuardrailInput
): ActionGuardrailResult {
  let action = input.currentAction;
  const ruleHits: string[] = [];
  const probs = input.classifier.probabilities;
  const scamPeak = Math.max(
    scoreOfCategory(input.categoryScores, "scam_bec"),
    scoreOfCategory(input.categoryScores, "scam_invoice_fraud"),
    scoreOfCategory(input.categoryScores, "scam_credential_phishing"),
    scoreOfCategory(input.categoryScores, "scam_malware_attachment"),
    scoreOfCategory(input.categoryScores, "scam_impersonation")
  );

  const strongHarmfulEvidence =
    probs.harmful >= 0.75 &&
    (scamPeak >= 60 || input.attachmentRiskScore >= 45 || input.urlsCount >= 4);

  const strongSpamEvidence =
    (input.primaryCategory === "newsletter" ||
      input.primaryCategory === "sales_marketing") &&
    probs.spam >= 0.6 &&
    probs.harmful < 0.45 &&
    input.attachmentRiskScore < 35;

  if (strongSpamEvidence && (action === "quarantine" || action === "block")) {
    action = "allow";
    ruleHits.push("spam_action_cap");
  }

  if (strongHarmfulEvidence && (action === "allow" || action === "escalate")) {
    action = probs.harmful >= 0.84 ? "quarantine" : "escalate";
    ruleHits.push("harmful_action_floor");
  }

  return {
    action,
    adjusted: action !== input.currentAction,
    ruleHits,
    note:
      ruleHits.length > 0
        ? `Action guardrails applied: ${ruleHits.join(", ")}.`
        : "No action guardrails applied.",
  };
}

export function reconcileMailClass(
  input: MailClassReconcileInput
): MailClassReconcileResult {
  const probs = input.classifier.probabilities;
  let mailClass = input.derivedMailClass;
  let threatType = input.derivedThreatType;
  const ruleHits: string[] = [];

  if (
    (input.primaryCategory === "newsletter" || input.primaryCategory === "sales_marketing") &&
    probs.spam >= 0.6 &&
    probs.harmful < 0.5
  ) {
    mailClass = "spam";
    threatType = "none";
    ruleHits.push("force_spam_promotional");
  } else if (probs.harmful >= 0.68) {
    mailClass = "harmful";
    if (threatType === "none") threatType = "unknown";
    ruleHits.push("force_harmful_high_prob");
  } else if (probs.actionable >= 0.55 && mailClass === "informational") {
    mailClass = "actionable";
    ruleHits.push("promote_actionable");
  } else if (probs.informational >= 0.62 && mailClass === "actionable") {
    mailClass = "informational";
    ruleHits.push("demote_informational");
  }

  return {
    mailClass,
    threatType,
    adjusted: mailClass !== input.derivedMailClass || threatType !== input.derivedThreatType,
    ruleHits,
    rationale:
      ruleHits.length > 0
        ? `Classification reconciled using ${ruleHits.join(", ")}.`
        : "Derived and classifier classes were aligned; no reconciliation applied.",
  };
}
