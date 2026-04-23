import type { InboxDecisionAxes } from "./decisionAxes";
import type { InboxEventInference } from "./eventTaxonomy";
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
  decisionAxes?: {
    attentionLevel: InboxDecisionAxes["attentionPriority"]["level"];
    securityLevel: InboxDecisionAxes["securitySeverity"]["level"];
    actionRoute: InboxDecisionAxes["actionRoute"]["route"];
  };
  eventContext?: Pick<InboxEventInference, "primaryEventType" | "secondaryTags">;
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
  if (
    category === "newsletter" ||
    category === "general" ||
    category === "deadline_scheduling" ||
    category === "sales_marketing" ||
    category === "ops_support" ||
    category === "executive_escalation"
  ) {
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
  if (args.primaryCategory === "newsletter") {
    return args.priorityScore >= 55 && args.trustedAction === "allow"
      ? "informational"
      : "spam";
  }
  if (
    hasAny(args.riskTags, ["newsletter/marketing signature detected"]) &&
    args.priorityScore < 55
  ) {
    return "spam";
  }

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
    return args.priorityScore >= 68 || args.trustedAction === "escalate"
      ? "actionable"
      : "informational";
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
    args.decisionAxes
      ? `Attention ${args.decisionAxes.attentionLevel}, security ${args.decisionAxes.securityLevel}, route ${args.decisionAxes.actionRoute}.`
      : null,
    args.eventContext
      ? `Primary event ${args.eventContext.primaryEventType}${
          args.eventContext.secondaryTags.length > 0
            ? ` with secondary tags ${args.eventContext.secondaryTags.join(", ")}`
            : ""
        }.`
      : null,
    `Top category evidence: ${topSignals.join(", ") || "none"}.`,
    `Trust/Reputation ${args.trustScore}/${args.reputationScore}.`,
    `Thread depth ${args.threadDepth} (risk density ${args.threadRiskDensity}).`,
  ]
    .filter(Boolean)
    .join(" ");

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
  if (args.decisionAxes) {
    evidenceRefs.push({
      type: "signal",
      ref: `attention:${args.decisionAxes.attentionLevel}`,
      weight: 0.5,
    });
    evidenceRefs.push({
      type: "signal",
      ref: `security:${args.decisionAxes.securityLevel}`,
      weight: 0.6,
    });
    evidenceRefs.push({
      type: "signal",
      ref: `route:${args.decisionAxes.actionRoute}`,
      weight: 0.55,
    });
  }
  if (args.eventContext) {
    evidenceRefs.push({
      type: "signal",
      ref: `event:${args.eventContext.primaryEventType}`,
      weight: 0.58,
    });
  }

  return {
    policyVersion: args.policyVersion,
    modelVersion: args.modelVersion,
    explanation,
    evidenceRefs: evidenceRefs.slice(0, 10),
  };
}
