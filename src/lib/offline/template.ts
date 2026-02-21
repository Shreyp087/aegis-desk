/**
 * Offline security template only.
 * This file is intentionally not wired into runtime routes yet.
 */

export type OfflineModeState = "disabled" | "shadow" | "enforced";

export type ScamCategory =
  | "scam_bec"
  | "scam_invoice_fraud"
  | "scam_credential_phishing"
  | "scam_malware_attachment"
  | "scam_impersonation";

export type TrustedCategory =
  | ScamCategory
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general"
  | "safe"
  | "uncertain";

export type DecisionAction = "allow" | "escalate" | "quarantine" | "block";

export type EvidenceSource =
  | "headers"
  | "body"
  | "links"
  | "attachments"
  | "historical_trust"
  | "model";

export type OfflineModeConfig = {
  enabled: boolean;
  state: OfflineModeState;
  blockOutboundNetwork: boolean;
  localModelsOnly: boolean;
  allowExternalResearch: boolean;
  allowRemoteDrafting: boolean;
  redactLogsByDefault: boolean;
  storeRawEmailDays: number;
  decisionPolicyVersion: string;
};

export type TrustedDecisionThresholds = {
  blockAtOrAbove: number;
  quarantineAtOrAbove: number;
  escalateAtOrAbove: number;
  uncertainBelow: number;
};

export type TrustedDecisionSignalWeights = {
  senderMismatch: number;
  urgentLanguage: number;
  paymentRequest: number;
  credentialRequest: number;
  suspiciousUrl: number;
  suspiciousAttachment: number;
  spoofingIndicators: number;
  lowHistoricalTrust: number;
};

export type DecisionEvidence = {
  id: string;
  source: EvidenceSource;
  signal: string;
  weight: number;
  reason: string;
};

export type TrustedDecisionResult = {
  category: TrustedCategory;
  action: DecisionAction;
  confidencePct: number;
  riskScore: number;
  evidence: DecisionEvidence[];
  reviewerNote: string;
};

export type OfflineMailInput = {
  id: string;
  from: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  rawEmail: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
  };
};

export type OfflineDecisionTemplate = {
  config: OfflineModeConfig;
  thresholds: TrustedDecisionThresholds;
  signalWeights: TrustedDecisionSignalWeights;
  supportedCategories: TrustedCategory[];
  // TODO: attach local model references (e.g., local phishing classifier + local LLM adjudicator).
  modelProviders: {
    scamClassifier: "TODO_LOCAL_MODEL";
    decisionAdjudicator: "TODO_LOCAL_MODEL";
  };
  // TODO: replace this placeholder with real offline classification pipeline.
  classify: (mail: OfflineMailInput) => Promise<TrustedDecisionResult>;
};

export const OFFLINE_MODE_TEMPLATE_CONFIG: OfflineModeConfig = {
  enabled: false,
  state: "disabled",
  blockOutboundNetwork: true,
  localModelsOnly: true,
  allowExternalResearch: false,
  allowRemoteDrafting: false,
  redactLogsByDefault: true,
  storeRawEmailDays: 7,
  decisionPolicyVersion: "offline-template-v1",
};

export const OFFLINE_MODE_TEMPLATE_THRESHOLDS: TrustedDecisionThresholds = {
  blockAtOrAbove: 90,
  quarantineAtOrAbove: 75,
  escalateAtOrAbove: 55,
  uncertainBelow: 40,
};

export const OFFLINE_MODE_TEMPLATE_WEIGHTS: TrustedDecisionSignalWeights = {
  senderMismatch: 18,
  urgentLanguage: 12,
  paymentRequest: 20,
  credentialRequest: 22,
  suspiciousUrl: 24,
  suspiciousAttachment: 20,
  spoofingIndicators: 18,
  lowHistoricalTrust: 12,
};

export const OFFLINE_MODE_TEMPLATE: OfflineDecisionTemplate = {
  config: OFFLINE_MODE_TEMPLATE_CONFIG,
  thresholds: OFFLINE_MODE_TEMPLATE_THRESHOLDS,
  signalWeights: OFFLINE_MODE_TEMPLATE_WEIGHTS,
  supportedCategories: [
    "scam_bec",
    "scam_invoice_fraud",
    "scam_credential_phishing",
    "scam_malware_attachment",
    "scam_impersonation",
    "security_phishing",
    "finance_payment",
    "legal_contract",
    "deadline_scheduling",
    "executive_escalation",
    "sales_marketing",
    "ops_support",
    "newsletter",
    "general",
    "safe",
    "uncertain",
  ],
  modelProviders: {
    scamClassifier: "TODO_LOCAL_MODEL",
    decisionAdjudicator: "TODO_LOCAL_MODEL",
  },
  async classify(mail) {
    return {
      category: "uncertain",
      action: "escalate",
      confidencePct: 0,
      riskScore: 0,
      evidence: [
        {
          id: `template-${mail.id}`,
          source: "model",
          signal: "offline_template_placeholder",
          weight: 0,
          reason: "Template mode only. Replace with offline classifier + rules.",
        },
      ],
      reviewerNote:
        "Offline template placeholder. No production decision logic is active in this scaffold.",
    };
  },
};

