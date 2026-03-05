import type {
  InboxDecisionTrace,
  InboxMailClass,
  InboxThreatType,
} from "./schemas";

export type DecisionTraceArgs = {
  primaryCategory: string;
  priorityScore: number;
  trustedAction: "allow" | "escalate" | "quarantine" | "block";
  riskTags: string[];
  topCategoryScores: Array<{ category: string; score: number }>;
  trustScore: number;
  reputationScore: number;
  threadDepth: number;
  threadRiskDensity: number;
  consensusScore: number;
  policyVersion: string;
  modelVersion: string;
};

function hasAny(tags: string[], values: string[]): boolean {
  const lower = tags.map((t) => t.toLowerCase());
  return values.some((value) => lower.includes(value.toLowerCase()));
}

export function deriveThreatType(args: {
  primaryCategory: string;
  riskTags: string[];
}): InboxThreatType {
  const category = args.primaryCategory;
  const tags = args.riskTags;

  if (category === "scam_credential_phishing" || category === "security_phishing") {
    return "phishing";
  }
  if (category === "scam_impersonation" || category === "scam_bec") {
    return "impersonation";
  }
  if (category === "scam_malware_attachment" || hasAny(tags, ["Malware Risk", "Suspicious Attachment"])) {
    return "malware";
  }
  if (category === "scam_invoice_fraud" || category === "finance_payment") {
    return "payment_fraud";
  }
  if (category === "legal_contract") {
    return "legal_risk";
  }
  if (category === "newsletter" || category === "general") {
    return "none";
  }
  return "unknown";
}

export function deriveMailClass(args: {
  primaryCategory: string;
  threatType: InboxThreatType;
  priorityScore: number;
  trustedAction: "allow" | "escalate" | "quarantine" | "block";
  riskTags: string[];
}): InboxMailClass {
  if (args.primaryCategory === "newsletter") return "spam";
  if (hasAny(args.riskTags, ["newsletter/marketing signature detected"])) return "spam";

  if (
    args.threatType !== "none" &&
    (args.trustedAction === "quarantine" ||
      args.trustedAction === "block" ||
      args.priorityScore >= 75)
  ) {
    return "harmful";
  }

  if (args.primaryCategory === "deadline_scheduling" || args.primaryCategory === "ops_support") {
    return "actionable";
  }
  if (args.primaryCategory === "sales_marketing") {
    return args.priorityScore >= 55 ? "actionable" : "informational";
  }
  if (args.primaryCategory === "general" && args.priorityScore < 45) {
    return "informational";
  }

  return args.priorityScore >= 50 ? "actionable" : "informational";
}

export function buildDecisionTrace(args: DecisionTraceArgs): InboxDecisionTrace {
  const topSignals = args.topCategoryScores
    .slice(0, 3)
    .map((entry) => `${entry.category}:${Math.round(entry.score)}`);

  const explanation = [
    `Primary category ${args.primaryCategory}.`,
    `Trusted action ${args.trustedAction} at priority ${args.priorityScore}/100.`,
    `Top category evidence: ${topSignals.join(", ") || "none"}.`,
    `Trust/Reputation ${args.trustScore}/${args.reputationScore}.`,
    `Thread depth ${args.threadDepth} (risk density ${args.threadRiskDensity}).`,
  ].join(" ");

  const evidenceRefs: InboxDecisionTrace["evidenceRefs"] = [];

  for (const tag of args.riskTags.slice(0, 4)) {
    evidenceRefs.push({ type: "signal", ref: tag, weight: 0.6 });
  }
  for (const entry of args.topCategoryScores.slice(0, 3)) {
    evidenceRefs.push({
      type: "category",
      ref: `${entry.category}:${Math.round(entry.score)}`,
      weight: Math.min(1, Math.max(0, entry.score / 100)),
    });
  }
  evidenceRefs.push({
    type: "trust",
    ref: `trust:${args.trustScore}`,
    weight: Math.min(1, Math.max(0, (100 - args.trustScore) / 100)),
  });
  evidenceRefs.push({
    type: "reputation",
    ref: `reputation:${args.reputationScore}`,
    weight: Math.min(1, Math.max(0, (100 - args.reputationScore) / 100)),
  });
  evidenceRefs.push({
    type: "thread",
    ref: `thread:${args.threadDepth}/${args.threadRiskDensity}`,
    weight: Math.min(1, Math.max(0, args.threadRiskDensity)),
  });
  evidenceRefs.push({
    type: "model",
    ref: `consensus:${args.consensusScore}`,
    weight: Math.min(1, Math.max(0, args.consensusScore / 100)),
  });

  return {
    policyVersion: args.policyVersion,
    modelVersion: args.modelVersion,
    explanation,
    evidenceRefs: evidenceRefs.slice(0, 10),
  };
}
