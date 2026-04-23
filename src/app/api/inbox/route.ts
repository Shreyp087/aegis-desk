import { createHash } from "crypto";
import { withAegisWorkflowSpan } from "@/lib/observability/respan/spans";

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { connectMongo } from "@/lib/db/mongoose";
import {
  classifyInboxMail,
  type IncidentHint,
  type MailClassifierResult,
} from "@/lib/inbox/classifier";
import {
  computeAdaptiveThresholds,
  loadAdaptiveThresholds,
  saveAdaptiveThresholds,
  type AdaptiveThresholdInput,
  type AdaptiveThresholdRecommendation,
  type AdaptiveThresholdResult,
} from "@/lib/inbox/adaptiveThresholds";
import {
  buildExplanation,
  buildSignalGroups,
  buildStructuredUncertainty,
  InboxExplanationSchema,
  InboxSignalGroupsSchema,
  InboxUncertaintySchema,
} from "@/lib/inbox/compatibility";
import {
  ConsensusAgreementScoresSchema,
  ConsensusModelOutputSchema,
  defaultAgreementScores,
  disagreementSeverity,
  evaluateConsensusRuns,
} from "@/lib/inbox/consensus";
import {
  buildPublicRequestUrl,
  fetchLatestGmailRawEmails,
  getValidGmailToken,
} from "@/lib/inbox/gmail";
import {
  appendInboxEvaluationLogEntries,
  buildGroundTruthPlaceholder,
  buildInboxEvaluationLogEntry,
} from "@/lib/inbox/evaluation";
import {
  applyFalsePositiveGuard,
  type FalsePositiveGuardResult,
} from "@/lib/inbox/falsePositiveGuard";
import {
  applyRoutingOverride,
  buildEnvDecisionPolicyConfig,
  InboxDecisionSchema,
  routeInboxDecision,
  type InboxDecisionPolicyConfig,
} from "@/lib/inbox/decision";
import {
  buildDecisionImportanceProfile,
  rebalanceDecisionImportanceProfile,
} from "@/lib/inbox/importance";
import {
  applyActionGuardrails,
  applyPriorityGuardrails,
  reconcileMailClass,
} from "@/lib/inbox/policy";
import {
  InboxDecisionTraceSchema,
  InboxMailClassEnum,
  InboxThreatTypeEnum,
  type InboxMailClass,
  type InboxThreatType,
} from "@/lib/inbox/schemas";
import {
  buildDecisionTrace,
  deriveMailClass,
  deriveThreatType,
} from "@/lib/inbox/signals";
import {
  predictUrgency,
  type UrgencyPredictorResult,
} from "@/lib/inbox/urgencyPredictor";
import {
  buildSessionStore,
  deriveClusterKey,
  hashSignal,
  updateRecord,
} from "@/lib/inbox/sessionStore";
import type { ClusterKey } from "@/lib/inbox/sessionStore.types";
import { buildTemporalContext } from "@/lib/inbox/temporalContext";
import type { TemporalContextResult } from "@/lib/inbox/temporalContext.types";
import {
  OFFLINE_MODE_TEMPLATE_THRESHOLDS,
  OFFLINE_MODE_TEMPLATE_WEIGHTS,
  getOfflineRuntimeConfig,
  isOfflineEnforced,
} from "@/lib/offline";
import { IncidentMemoryModel } from "@/lib/models/IncidentMemory";
import { InboxEvaluationLogModel } from "@/lib/models/InboxEvaluationLog";
import { SenderReputationSnapshotModel } from "@/lib/models/SenderReputationSnapshot";
import {
  buildEnvConsensusPolicy,
  INBOX_ADMIN_SETTINGS_COOKIE,
  parseInboxAdminSettingsCookie,
  resolveConsensusPolicy,
  type InboxConsensusPolicy,
} from "@/lib/inbox/settings";

type Category =
  | "scam_bec"
  | "scam_invoice_fraud"
  | "scam_credential_phishing"
  | "scam_malware_attachment"
  | "scam_impersonation"
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general";

type Priority = "high" | "medium" | "low";
type TrustedDecisionAction = "allow" | "escalate" | "quarantine" | "block";

type TrustNode = {
  seen: number;
  high: number;
  medium: number;
  lastSeen: number;
};

type TrustGraph = {
  senders: Record<string, TrustNode>;
  domains: Record<string, TrustNode>;
};

type CategoryScore = {
  category: Category;
  score: number;
  reason: string;
};

type ReputationProfile = {
  score: number;
  findings: string[];
  domains: string[];
};

type ThreadProfile = {
  key: string;
  depth: number;
  riskDensity: number;
};

type ParsedEmail = {
  id: string;
  raw: string;
  receivedAt: Date | null;
  from: string;
  subject: string;
  senderEmail: string;
  senderDomain: string;
  body: string;
  threadKey: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
    attachmentRiskScore: number;
    urlDomains: string[];
  };
};

type PromotionalSummary = {
  lowRiskPromotional: boolean;
  promotionalConfidence: number;
  promoUrgencyHits: number;
  senderPromoHints: number;
};

type PredictiveSenderHistory = {
  subjectHashes: string[];
  priorPriorityScores: number[];
  outcomeLabels: string[];
  avgResponseGapHours: number | null;
  lastEmailFromSender: Date | null;
};

type ScoringSnapshot = {
  priorityScore: number;
  priority: Priority;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  trustScore: number;
  reputation: ReputationProfile;
  thread: ThreadProfile;
  decisionImportance: ReturnType<typeof buildDecisionImportanceProfile>;
  promotional: PromotionalSummary;
};

type ScoredEmail = ParsedEmail & ScoringSnapshot & {
  classifier: MailClassifierResult;
  incidentHints: IncidentHint[];
  temporalContext: TemporalContextResult;
  urgencyPrediction: UrgencyPredictorResult;
  priorityGuardrail: {
    adjusted: boolean;
    ruleHits: string[];
    rationale: string;
  };
  baseUncertaintyPercent: number;
  evidenceStrength: number;
  falsePositiveGuard: FalsePositiveGuardResult;
};

type SessionRecordMeta = {
  senderDomainHash: string;
  threadKeyHash: string;
  clusterKey: ClusterKey;
  receivedAtMs: number;
  preScorePrimaryCategory: string;
};

const CategoryEnum = z.enum([
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
]);

const PriorityEnum = z.enum(["high", "medium", "low"]);
const TrustedDecisionActionEnum = z.enum(["allow", "escalate", "quarantine", "block"]);

const InboxRequestSchema = z.object({
  mode: z.enum(["manual", "gmail"]).default("manual"),
  emails: z.array(z.string()).default([]),
  gmail: z
    .object({
      maxResults: z.number().int().min(1).max(50).optional(),
      query: z.string().min(1).max(200).optional(),
    })
    .optional(),
  userContext: z
    .object({
      orgDomains: z.array(z.string()).optional(),
    })
    .optional(),
});

const CategoryScoreSchema = z.object({
  category: CategoryEnum,
  score: z.number().min(0).max(100),
  reason: z.string(),
});

const ClassifierSchema = z.object({
  modelVersion: z.string(),
  predictedClass: InboxMailClassEnum,
  probabilities: z.object({
    spam: z.number().min(0).max(1),
    harmful: z.number().min(0).max(1),
    actionable: z.number().min(0).max(1),
    informational: z.number().min(0).max(1),
  }),
  memorySampleCount: z.number().int().min(0),
  rationale: z.string(),
});

const GuardrailSchema = z.object({
  policyVersion: z.string(),
  ruleHits: z.array(z.string()),
  rationale: z.string(),
  priorityAdjusted: z.boolean(),
  actionAdjusted: z.boolean(),
  classificationAdjusted: z.boolean(),
});

const MemoryRefSchema = z.object({
  sourceHash: z.string(),
  subjectHash: z.string(),
  senderEmailHash: z.string(),
});

const AlertSchema = z.object({
  id: z.string(),
  from: z.string(),
  senderEmail: z.string(),
  senderDomain: z.string(),
  subject: z.string(),
  priorityScore: z.number().min(0).max(100),
  priority: PriorityEnum,
  primaryCategory: CategoryEnum,
  mailClass: InboxMailClassEnum,
  threatType: InboxThreatTypeEnum,
  decisionTrace: InboxDecisionTraceSchema,
  categoryScores: z.array(CategoryScoreSchema),
  riskTags: z.array(z.string()),
  signals: z.array(z.string()),
  signalGroups: InboxSignalGroupsSchema,
  uncertainty: InboxUncertaintySchema,
  explanation: InboxExplanationSchema,
  decision: InboxDecisionSchema,
  suggestedAction: z.string(),
  draftReply: z.string(),
  consensusScore: z.number().min(0).max(100),
  consensusNote: z.string(),
  agreement_scores: ConsensusAgreementScoresSchema,
  disagreement_flags: z.array(z.string()),
  consensus_strength: z.number().min(0).max(1),
  trustedDecision: z.object({
    action: TrustedDecisionActionEnum,
    confidencePct: z.number().min(0).max(100),
    riskScore: z.number().min(0).max(100),
    note: z.string(),
  }),
  classifier: ClassifierSchema,
  guardrails: GuardrailSchema,
  memoryRef: MemoryRefSchema,
  trustScore: z.number().min(0).max(100),
  reputationScore: z.number().min(0).max(100),
  reputationFindings: z.array(z.string()),
  thread: z.object({
    key: z.string(),
    depth: z.number().min(1),
    riskDensity: z.number().min(0).max(1),
  }),
  uncertaintyPercent: z.number().min(0).max(100),
  baseUncertaintyPercent: z.number().min(0).max(100),
  rawEmail: z.string(),
  extracted: z.object({
    deadlines: z.array(z.string()),
    moneyMentions: z.array(z.string()),
    urls: z.array(z.string()),
    attachments: z.array(z.string()),
    attachmentRiskScore: z.number().min(0).max(100),
  }),
});

type Alert = z.infer<typeof AlertSchema>;

const InboxResponseSchema = z.object({
  ok: z.literal(true),
  alerts: z.array(AlertSchema),
  meta: z.object({
    mode: z.string(),
    processingMode: z.enum(["offline_enforced", "hybrid_remote_llm"]),
    offlineState: z.string(),
    scanned: z.number(),
    highCount: z.number(),
    mediumCount: z.number(),
    lowCount: z.number(),
    policyVersion: z.string(),
    modelVersion: z.string(),
    classifierVersion: z.string(),
    guardrailVersion: z.string(),
    learningSamplesUsed: z.number().int().min(0),
    consensusMode: z.enum(["single", "multi"]),
    consensusMaxModels: z.number().int().min(1).max(8),
    consensusSource: z.enum(["env_default", "admin_override"]),
    adaptiveDiagnostics: z.object({
      sampleSize: z.number().int().min(0),
      falsePositiveRate: z.number().min(0).max(1),
      falseNegativeRate: z.number().min(0).max(1),
      fpGuardEffectiveness: z.number().min(0),
      avgUncertaintyAtFP: z.number().min(0),
      dominantFPCategory: z.string(),
      recommendedFocus: z.string(),
    }),
  }),
});

const TRUST_COOKIE = "aegis_inbox_trust_graph";
const TRUST_COOKIE_TTL_SECONDS = 120 * 24 * 60 * 60;

const HIGH_RISK_ATTACHMENT_EXT = new Set(["exe", "js", "vbs", "bat", "cmd", "scr", "hta", "iso", "dll"]);
const MEDIUM_RISK_ATTACHMENT_EXT = new Set(["zip", "rar", "7z", "docm", "xlsm", "pptm", "html", "htm"]);
const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".icu", ".ru", ".work", ".live"];
const FREE_MAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "icloud.com"]);

const PATTERNS = {
  security: [
    /\bpassword\b/i,
    /\bcredentials?\b/i,
    /\blogin\b/i,
    /\breset\b/i,
    /\b2fa\b/i,
    /\bmfa\b/i,
    /\bverify your account\b/i,
    /\bsecurity alert\b/i,
    /\bsuspicious sign[- ]in\b/i,
  ],
  payment: [
    /\bwire transfer\b/i,
    /\bbank details?\b/i,
    /\binvoice\b/i,
    /\bpayment\b/i,
    /\bach\b/i,
    /\bbeneficiary\b/i,
    /\baccount number\b/i,
    /\brefund\b/i,
  ],
  legal: [
    /\bagreement\b/i,
    /\bcontract\b/i,
    /\bnda\b/i,
    /\bindemnif/i,
    /\bliability\b/i,
    /\bterms\b/i,
    /\bgoverning law\b/i,
    /\bsignature\b/i,
  ],
  deadline: [
    /\burgent\b/i,
    /\basap\b/i,
    /\bimmediately\b/i,
    /\baction required\b/i,
    /\bwithin\s+\d+\s*(hours|days)\b/i,
    /\btoday\b/i,
    /\btomorrow\b/i,
    /\beod\b/i,
    /\bend of day\b/i,
    /\bdue\b/i,
  ],
  scheduling: [
    /\bmeeting\b/i,
    /\bcall\b/i,
    /\bcalendar\b/i,
    /\bschedule\b/i,
    /\breschedule\b/i,
    /\binvite\b/i,
    /\bavailability\b/i,
  ],
  executive: [/\bceo\b/i, /\bcfo\b/i, /\bcto\b/i, /\bfounder\b/i, /\bboard\b/i, /\bexecutive\b/i],
  sales: [
    /\bproposal\b/i,
    /\bquote\b/i,
    /\bdemo\b/i,
    /\bpricing\b/i,
    /\bdiscount\b/i,
    /\btrial\b/i,
    /\bpromo code\b/i,
    /\bcoupon\b/i,
    /\bpercent off\b/i,
    /\b\d{1,3}% off\b/i,
    /\bbogo\b/i,
    /\bbuy one get one\b/i,
    /\bsale\b/i,
  ],
  support: [/\bticket\b/i, /\bincident\b/i, /\boutage\b/i, /\bissue\b/i, /\bbug\b/i, /\bsupport\b/i],
  newsletter: [/\bunsubscribe\b/i, /\bnewsletter\b/i, /\bweekly digest\b/i, /\bmarketing\b/i, /\bpromotion\b/i],
  impersonation: [
    /\bceo request\b/i,
    /\bcfo request\b/i,
    /\bexecutive request\b/i,
    /\bon behalf of\b/i,
    /\bkeep this confidential\b/i,
    /\bdo not call\b/i,
    /\bgift card\b/i,
    /\bvendor changed bank details\b/i,
    /\bnew bank account\b/i,
  ],
  malware: [/\benabled macro\b/i, /\bmacro-enabled\b/i, /\bdownload attachment\b/i, /\bopen attachment\b/i],
};

const PROMOTIONAL_URGENCY_PATTERNS = [
  /\btoday only\b/i,
  /\bends tonight\b/i,
  /\blast chance\b/i,
  /\bfinal hours\b/i,
  /\bending soon\b/i,
  /\blimited time offer\b/i,
  /\bshop now\b/i,
  /\bclaim your deal\b/i,
];

const PROMOTIONAL_SENDER_HINT_PATTERNS = [
  /\bdeal(s)?\b/i,
  /\boffer(s)?\b/i,
  /\bpromo\b/i,
  /\bsale(s)?\b/i,
  /\bmarketing\b/i,
  /\bnewsletter\b/i,
  /\bupdates\b/i,
  /\bshop\b/i,
  /\bno-?reply\b/i,
];

const CALIBRATION_PROFILES: Record<
  Category,
  { slope: number; offset: number; reliabilityWeight: number }
> = {
  scam_bec: { slope: 1.12, offset: 5, reliabilityWeight: 0.76 },
  scam_invoice_fraud: { slope: 1.1, offset: 4, reliabilityWeight: 0.74 },
  scam_credential_phishing: { slope: 1.12, offset: 5, reliabilityWeight: 0.76 },
  scam_malware_attachment: { slope: 1.09, offset: 4, reliabilityWeight: 0.72 },
  scam_impersonation: { slope: 1.08, offset: 4, reliabilityWeight: 0.71 },
  security_phishing: { slope: 1.08, offset: 3, reliabilityWeight: 0.7 },
  finance_payment: { slope: 1.05, offset: 2, reliabilityWeight: 0.68 },
  legal_contract: { slope: 1.02, offset: 1, reliabilityWeight: 0.62 },
  deadline_scheduling: { slope: 0.98, offset: -2, reliabilityWeight: 0.55 },
  executive_escalation: { slope: 1.0, offset: 0, reliabilityWeight: 0.58 },
  sales_marketing: { slope: 0.95, offset: -4, reliabilityWeight: 0.48 },
  ops_support: { slope: 0.97, offset: -2, reliabilityWeight: 0.53 },
  newsletter: { slope: 0.92, offset: -6, reliabilityWeight: 0.4 },
  general: { slope: 0.96, offset: -3, reliabilityWeight: 0.45 },
};

const INBOX_POLICY_VERSION =
  process.env.INBOX_POLICY_VERSION || "inbox-policy-v4-decision-importance";

/**
 * Builds the full threshold set currently active in the inbox pipeline before adaptive overrides are applied.
 *
 * This plugs into adaptive threshold startup loading so the scanner can merge learned values with env-backed defaults.
 */
function buildAdaptiveThresholdDefaults(
  decisionPolicyConfig: InboxDecisionPolicyConfig
): AdaptiveThresholdRecommendation {
  return {
    autoTriageConfidenceMin: decisionPolicyConfig.autoTriageConfidenceMinPct,
    autoTriageUncertaintyMax: decisionPolicyConfig.autoTriageUncertaintyMaxPct,
    escalateConfidenceMin: decisionPolicyConfig.escalateConfidenceMinPct,
    escalateUncertaintyMax: decisionPolicyConfig.escalateUncertaintyMaxPct,
    riskMediumMin: decisionPolicyConfig.riskMediumMinScore,
    riskHighMin: decisionPolicyConfig.riskHighMinScore,
    harmfulPriorityFloor: 84,
    urgentDecisionFloor: 80,
    deadlineHighFloor: 80,
    routineNoiseCap: 36,
  };
}

/**
 * Merges cached adaptive threshold recommendations over the current default threshold set.
 *
 * This plugs into scanner startup before any email is processed so learned calibration wins only where a cache exists.
 */
function mergeAdaptiveThresholds(args: {
  defaults: AdaptiveThresholdRecommendation;
  cached?: AdaptiveThresholdResult | null;
}): AdaptiveThresholdRecommendation {
  return {
    ...args.defaults,
    ...(args.cached?.recommended ?? {}),
  };
}

/**
 * Maps the broader adaptive threshold set back into the routing-policy config shape used by routeInboxDecision().
 *
 * This plugs into decision routing after adaptive thresholds are loaded so auto-triage and escalation reuse learned calibration.
 */
function buildEffectiveDecisionPolicyConfig(
  thresholds: AdaptiveThresholdRecommendation,
  fallback: InboxDecisionPolicyConfig
): InboxDecisionPolicyConfig {
  return {
    ...fallback,
    autoTriageConfidenceMinPct: thresholds.autoTriageConfidenceMin,
    autoTriageUncertaintyMaxPct: thresholds.autoTriageUncertaintyMax,
    escalateConfidenceMinPct: thresholds.escalateConfidenceMin,
    escalateUncertaintyMaxPct: thresholds.escalateUncertaintyMax,
    riskMediumMinScore: thresholds.riskMediumMin,
    riskHighMinScore: thresholds.riskHighMin,
  };
}

/**
 * Converts a numeric priority score into the standard inbox priority band.
 *
 * This plugs into predictive urgency and adaptive threshold rewrites when the route recomputes score bands outside scoreEmail().
 */
function priorityFromScore(score: number): Priority {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/**
 * Recomputes the raw priority score from the current decision profile, allowing adaptive thresholds to replace the routine-noise cap.
 *
 * This plugs into the route right after predictive urgency adjusts the decision profile and before classifier/guardrail stages run.
 */
function recomputePriorityFromDecisionProfile(args: {
  decisionImportance: ReturnType<typeof buildDecisionImportanceProfile>;
  routineNoiseCap: number;
}): { priorityScore: number; priority: Priority; routineNoiseApplied: boolean } {
  let priorityScore =
    6 +
    args.decisionImportance.threatScore * 0.34 +
    args.decisionImportance.urgencyScore * 0.33 +
    args.decisionImportance.relevanceScore * 0.19 +
    args.decisionImportance.opportunityScore * 0.15 -
    args.decisionImportance.noiseScore * 0.3;

  const verifyNowCombo =
    args.decisionImportance.threatScore >= 72 &&
    args.decisionImportance.trustGapScore >= 55;
  const actNowCombo =
    args.decisionImportance.urgencyScore >= 70 &&
    args.decisionImportance.relevanceScore >= 48;
  const valuableOpportunityCombo =
    args.decisionImportance.opportunityScore >= 62 &&
    args.decisionImportance.affinityScore >= 28 &&
    args.decisionImportance.threatScore < 58;
  const routineNoiseCombo =
    args.decisionImportance.noiseScore >= 74 &&
    args.decisionImportance.urgencyScore < 45 &&
    args.decisionImportance.threatScore < 50 &&
    args.decisionImportance.opportunityScore < 60;

  if (verifyNowCombo) priorityScore = Math.max(priorityScore, 84);
  if (actNowCombo) priorityScore = Math.max(priorityScore, 80);
  if (valuableOpportunityCombo) priorityScore = Math.max(priorityScore, 56);
  if (routineNoiseCombo) {
    priorityScore = Math.min(priorityScore, args.routineNoiseCap);
  }

  const rounded = clamp(Math.round(priorityScore), 0, 100);
  return {
    priorityScore: rounded,
    priority: priorityFromScore(rounded),
    routineNoiseApplied: routineNoiseCombo,
  };
}

/**
 * Applies adaptive replacements for the hardcoded priority floors and caps inside the existing guardrail stage.
 *
 * This plugs into the route immediately after applyPriorityGuardrails() so learned thresholds can take effect without modifying policy.ts.
 */
function applyAdaptivePriorityCalibration(args: {
  baseScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  classifier: MailClassifierResult;
  decisionImportance: ReturnType<typeof buildDecisionImportanceProfile>;
  deadlineCount: number;
  attachmentRiskScore: number;
  urlsCount: number;
  trustScore: number;
  reputationScore: number;
  thresholds: AdaptiveThresholdRecommendation;
}): {
  priorityScore: number;
  priority: Priority;
  adjusted: boolean;
  ruleHits: string[];
  rationale: string;
} {
  const securityScore = scoreOfCategory(args.categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(args.categoryScores, "finance_payment");
  const scamPeak = Math.max(
    scoreOfCategory(args.categoryScores, "scam_bec"),
    scoreOfCategory(args.categoryScores, "scam_invoice_fraud"),
    scoreOfCategory(args.categoryScores, "scam_credential_phishing"),
    scoreOfCategory(args.categoryScores, "scam_malware_attachment"),
    scoreOfCategory(args.categoryScores, "scam_impersonation")
  );
  const riskyEvidence =
    scamPeak >= 58 ||
    securityScore >= 58 ||
    financeScore >= 62 ||
    args.attachmentRiskScore >= 40 ||
    args.urlsCount >= 5 ||
    args.trustScore <= 30 ||
    args.reputationScore <= 35;
  let priorityScore = args.baseScore;
  const ruleHits: string[] = [];

  if (
    args.classifier.probabilities.harmful >= 0.74 &&
    (riskyEvidence || scamPeak >= 65 || args.attachmentRiskScore >= 48)
  ) {
    const nextScore = Math.max(priorityScore, args.thresholds.harmfulPriorityFloor);
    if (nextScore !== priorityScore) {
      priorityScore = nextScore;
      ruleHits.push("adaptive_harmful_priority_floor");
    }
  }

  if (
    args.decisionImportance.urgencyScore >= 62 &&
    args.decisionImportance.relevanceScore >= 50 &&
    args.decisionImportance.noiseScore < 72
  ) {
    const nextScore = Math.max(priorityScore, args.thresholds.urgentDecisionFloor);
    if (nextScore !== priorityScore) {
      priorityScore = nextScore;
      ruleHits.push("adaptive_urgent_decision_floor");
    }
  }

  if (
    args.primaryCategory === "deadline_scheduling" &&
    args.deadlineCount > 0 &&
    args.decisionImportance.relevanceScore >= 44 &&
    args.classifier.probabilities.spam < 0.45
  ) {
    const nextScore = Math.max(priorityScore, args.thresholds.deadlineHighFloor);
    if (nextScore !== priorityScore) {
      priorityScore = nextScore;
      ruleHits.push("adaptive_deadline_high_floor");
    }
  }

  if (
    args.decisionImportance.noiseScore >= 74 &&
    args.decisionImportance.urgencyScore < 45 &&
    args.decisionImportance.threatScore < 50 &&
    args.decisionImportance.opportunityScore < 60
  ) {
    const nextScore = Math.min(priorityScore, args.thresholds.routineNoiseCap);
    if (nextScore !== priorityScore) {
      priorityScore = nextScore;
      ruleHits.push("adaptive_routine_noise_cap");
    }
  }

  const rounded = clamp(Math.round(priorityScore), 0, 100);
  return {
    priorityScore: rounded,
    priority: priorityFromScore(rounded),
    adjusted: rounded !== args.baseScore,
    ruleHits,
    rationale:
      ruleHits.length > 0
        ? `Adaptive thresholds applied: ${ruleHits.join(", ")}.`
        : "No adaptive priority threshold adjustments applied.",
  };
}

/**
 * Estimates the sender's historical actionable cadence from incident-memory timestamps.
 *
 * This plugs into predictive urgency history loading so sender velocity can be inferred even before explicit reply telemetry exists.
 */
function computeAvgResponseGapHoursFromDocs(
  docs: Array<{
    createdAt?: Date;
    priorityScore?: number;
    outcomeLabel?: string;
  }>
): number | null {
  if (docs.length < 2) return null;
  const sorted = [...docs]
    .filter((doc): doc is { createdAt: Date; priorityScore?: number; outcomeLabel?: string } =>
      doc.createdAt instanceof Date && Number.isFinite(doc.createdAt.getTime())
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (sorted.length < 2) return null;

  const actionableGaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    const looksActionable =
      current.outcomeLabel === "actionable_correct" ||
      current.priorityScore !== undefined && current.priorityScore >= 50;
    if (!looksActionable) continue;

    const gapHours =
      (current.createdAt.getTime() - previous.createdAt.getTime()) / 3600000;
    if (Number.isFinite(gapHours) && gapHours > 0) {
      actionableGaps.push(gapHours);
    }
  }

  return actionableGaps.length > 0
    ? Number(
        (
          actionableGaps.reduce((sum, gap) => sum + gap, 0) /
          actionableGaps.length
        ).toFixed(2)
      )
    : null;
}

/**
 * Loads predictive sender history used by urgencyPredictor() from incident memory.
 *
 * This plugs into scanner startup before per-email scoring begins so urgency prediction can incorporate subject novelty and cadence data.
 */
async function loadPredictiveSenderHistory(
  parsedEmails: ParsedEmail[]
): Promise<Record<string, PredictiveSenderHistory>> {
  const empty: Record<string, PredictiveSenderHistory> = {};
  for (const email of parsedEmails) {
    empty[email.id] = {
      subjectHashes: [],
      priorPriorityScores: [],
      outcomeLabels: [],
      avgResponseGapHours: null,
      lastEmailFromSender: null,
    };
  }

  if (!process.env.MONGODB_URI || parsedEmails.length === 0) {
    return empty;
  }

  try {
    await connectMongo();

    const senderDomains = Array.from(
      new Set(parsedEmails.map((email) => email.senderDomain).filter(Boolean))
    );
    const senderEmailHashes = Array.from(
      new Set(
        parsedEmails
          .map((email) =>
            email.senderEmail ? createHashKey(`sender:${email.senderEmail}`) : ""
          )
          .filter(Boolean)
      )
    );

    if (senderDomains.length === 0 && senderEmailHashes.length === 0) {
      return empty;
    }

    const docs = (await IncidentMemoryModel.find({
      $or: [
        ...(senderDomains.length > 0
          ? [{ senderDomain: { $in: senderDomains } }]
          : []),
        ...(senderEmailHashes.length > 0
          ? [{ senderEmailHash: { $in: senderEmailHashes } }]
          : []),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(1200)
      .lean()
      .exec()) as Array<{
      senderDomain?: string;
      senderEmailHash?: string;
      subjectHash?: string;
      priorityScore?: number;
      outcomeLabel?: string;
      createdAt?: Date;
    }>;

    for (const email of parsedEmails) {
      const senderEmailHash = email.senderEmail
        ? createHashKey(`sender:${email.senderEmail}`)
        : "";
      const matchingDocs = docs.filter(
        (doc) =>
          (senderEmailHash && doc.senderEmailHash === senderEmailHash) ||
          (email.senderDomain && doc.senderDomain === email.senderDomain)
      );
      const receivedAtMs = email.receivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const lastEmailFromSender = matchingDocs
        .map((doc) => (doc.createdAt instanceof Date ? doc.createdAt : null))
        .filter((value): value is Date => Boolean(value))
        .find((createdAt) => createdAt.getTime() < receivedAtMs) ?? null;

      empty[email.id] = {
        subjectHashes: matchingDocs
          .map((doc) => (typeof doc.subjectHash === "string" ? doc.subjectHash : ""))
          .filter(Boolean)
          .slice(0, 40),
        priorPriorityScores: matchingDocs
          .map((doc) =>
            typeof doc.priorityScore === "number"
              ? clamp(Math.round(doc.priorityScore), 0, 100)
              : 0
          )
          .slice(0, 40),
        outcomeLabels: matchingDocs
          .map((doc) => (typeof doc.outcomeLabel === "string" ? doc.outcomeLabel : ""))
          .filter(Boolean)
          .slice(0, 40),
        avgResponseGapHours: computeAvgResponseGapHoursFromDocs(matchingDocs),
        lastEmailFromSender,
      };
    }
  } catch (error) {
    console.warn("Predictive sender history loading skipped:", error);
  }

  return empty;
}

/**
 * Extracts the cumulative false-positive guard score reduction from persisted guardrail traces.
 *
 * This plugs into adaptive-threshold history loading so calibration can measure whether the shipped FP Guard is materially reducing noise.
 */
function parseFalsePositiveGuardDeltaFromSignals(signals: string[]): number {
  return signals.reduce((sum, signal) => {
    const match = signal.match(/^false-positive guard [\w-]+\s+(-?\d+):/i);
    if (!match) return sum;
    const delta = Number(match[1]);
    return Number.isFinite(delta) ? sum + Math.abs(delta) : sum;
  }, 0);
}

/**
 * Loads the recent labeled outcome history required by adaptive threshold calibration.
 *
 * This plugs into the end-of-scan adaptation step after alerts are persisted so the next scan can tighten or relax thresholds from real feedback.
 */
async function loadRecentAdaptiveOutcomeHistory(
  limit: number
): Promise<AdaptiveThresholdInput["outcomeHistory"]> {
  if (!process.env.MONGODB_URI) {
    return [];
  }

  try {
    await connectMongo();

    const incidents = (await IncidentMemoryModel.find({
      outcomeLabel: { $ne: "" },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()) as Array<{
      sourceEmailId?: string;
      priorityScore?: number;
      outcomeLabel?: string;
      mailClass?: string;
      primaryCategory?: string;
      consensusScore?: number;
      uncertaintyScore?: number;
      deterministicSignals?: {
        guardrails?: { ruleHits?: string[] };
        signals?: string[];
      };
      signals?: string[];
      createdAt?: Date;
    }>;

    const messageIds = incidents
      .map((incident) =>
        typeof incident.sourceEmailId === "string" ? incident.sourceEmailId : ""
      )
      .filter(Boolean);
    const evaluationLogs = messageIds.length
      ? ((await InboxEvaluationLogModel.find({
          messageId: { $in: messageIds },
        })
          .sort({ loggedAt: -1 })
          .lean()
          .exec()) as Array<{
          messageId?: string;
          routingAction?: string;
        }>)
      : [];
    const routingByMessageId = new Map<string, string>();
    for (const log of evaluationLogs) {
      if (
        typeof log.messageId === "string" &&
        typeof log.routingAction === "string" &&
        !routingByMessageId.has(log.messageId)
      ) {
        routingByMessageId.set(log.messageId, log.routingAction);
      }
    }

    return incidents.map((incident) => {
      const priorityScore =
        typeof incident.priorityScore === "number"
          ? clamp(Math.round(incident.priorityScore), 0, 100)
          : 0;
      const guardRuleHits = incident.deterministicSignals?.guardrails?.ruleHits ?? [];
      const signalSource = [
        ...(incident.deterministicSignals?.signals ?? []),
        ...(incident.signals ?? []),
      ];
      return {
        priorityScore,
        priorityBand: priorityFromScore(priorityScore),
        outcomeLabel:
          typeof incident.outcomeLabel === "string" ? incident.outcomeLabel : "",
        mailClass: typeof incident.mailClass === "string" ? incident.mailClass : "",
        primaryCategory:
          typeof incident.primaryCategory === "string"
            ? incident.primaryCategory
            : "general",
        fpGuardActivated: guardRuleHits.some((rule) =>
          rule.startsWith("stale_urgency_decay") ||
          rule.startsWith("habit_open_sender_discount") ||
          rule.startsWith("thread_fatigue_") ||
          rule.startsWith("trusted_bulk_bleed_correction") ||
          rule.startsWith("single_signal_confidence_floor") ||
          rule.startsWith("feedback_memory_")
        ),
        fpGuardDelta: parseFalsePositiveGuardDeltaFromSignals(signalSource),
        consensusScore:
          typeof incident.consensusScore === "number"
            ? clamp(Math.round(incident.consensusScore), 0, 100)
            : 0,
        uncertainty:
          typeof incident.uncertaintyScore === "number"
            ? clamp(Math.round(incident.uncertaintyScore * 100), 0, 100)
            : 0,
        timestamp:
          incident.createdAt instanceof Date ? incident.createdAt : new Date(0),
        routingAction:
          typeof incident.sourceEmailId === "string"
            ? routingByMessageId.get(incident.sourceEmailId)
            : undefined,
      };
    });
  } catch (error) {
    console.warn("Adaptive outcome history loading skipped:", error);
    return [];
  }
}

function inboxModelVersion(args: {
  offlineEnforced: boolean;
  consensusPolicy: InboxConsensusPolicy;
}): string {
  if (args.offlineEnforced) return "deterministic-offline-v1";
  if (!args.consensusPolicy.enabled) return "single-model-assist-v2";
  return `multi-model-consensus-v2-${args.consensusPolicy.maxModels}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countHits(text: string, regexes: RegExp[]): number {
  return regexes.reduce((sum, re) => sum + (re.test(text) ? 1 : 0), 0);
}

function countSenderPromoHints(senderEmail: string, senderDomain: string): number {
  const localPart = senderEmail.includes("@") ? senderEmail.split("@")[0] : senderEmail;
  const senderText = `${localPart} ${senderDomain}`.trim();
  if (!senderText) return 0;
  return countHits(senderText, PROMOTIONAL_SENDER_HINT_PATTERNS);
}

function buildPromotionalContext(args: {
  text: string;
  senderEmail: string;
  senderDomain: string;
  attachmentRiskScore: number;
  securityHits: number;
  paymentHits: number;
  legalHits: number;
  impersonationHits: number;
  malwareHits: number;
  deadlineHits: number;
}) {
  const salesHits = countHits(args.text, PATTERNS.sales);
  const newsletterHits = countHits(args.text, PATTERNS.newsletter);
  const promoUrgencyHits = countHits(args.text, PROMOTIONAL_URGENCY_PATTERNS);
  const senderPromoHits = countSenderPromoHints(args.senderEmail, args.senderDomain);
  const promotionalConfidence =
    salesHits * 0.7 + newsletterHits * 0.95 + promoUrgencyHits * 0.7 + senderPromoHits * 0.8;
  const lowRiskPromotional =
    promotionalConfidence >= 2.1 &&
    args.securityHits === 0 &&
    args.paymentHits === 0 &&
    args.legalHits === 0 &&
    args.impersonationHits === 0 &&
    args.malwareHits === 0 &&
    args.attachmentRiskScore < 25;
  const effectiveDeadlineHits = lowRiskPromotional
    ? Math.max(0, args.deadlineHits - promoUrgencyHits)
    : args.deadlineHits;

  return {
    salesHits,
    newsletterHits,
    promoUrgencyHits,
    senderPromoHits,
    promotionalConfidence,
    lowRiskPromotional,
    effectiveDeadlineHits,
  };
}

function extractHeader(raw: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "im");
  const m = raw.match(re);
  return (m?.[1] || "").trim();
}

function extractSubject(raw: string): string {
  return extractHeader(raw, "Subject") || "(No subject)";
}

function extractFrom(raw: string): string {
  return extractHeader(raw, "From") || "(Unknown sender)";
}

/**
 * Parses the Date header into a stable received timestamp when the raw email provides one.
 *
 * This plugs into the post-scoring false-positive guard so stale deadline language can be anchored
 * to when the message actually arrived instead of to scan time alone.
 */
function extractReceivedAt(raw: string): Date | null {
  const dateHeader = extractHeader(raw, "Date");
  if (!dateHeader) return null;
  const parsed = new Date(dateHeader);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function extractBody(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const bodyStart = lines.findIndex((line) => /^body:\s*$/i.test(line) || /^body:/i.test(line));
  if (bodyStart >= 0) {
    return lines.slice(bodyStart + 1).join("\n").trim();
  }

  return lines
    .filter((line) => !/^(from:|to:|subject:|date:|thread-id:|attachments:)\s*/i.test(line))
    .join("\n")
    .trim();
}

function senderEmailFromFromHeader(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const email = (m?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.replace(/[^\w@.+-]/g, "").toLowerCase();
}

function domainFromFromHeader(from: string): string {
  const emailMatch = from.match(/<([^>]+)>/);
  const email = (emailMatch?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).replace(/[^\w.-]/g, "").toLowerCase();
}

function extractThreadId(raw: string): string {
  return extractHeader(raw, "Thread-Id");
}

function normalizeSubjectForThread(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveThreadKey(raw: string, subject: string, senderDomain: string): string {
  const threadId = extractThreadId(raw);
  if (threadId) return `gmail:${threadId}`;
  return `subject:${senderDomain || "unknown"}:${normalizeSubjectForThread(subject) || "none"}`;
}

function extractDeadlines(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bby\s+(end of day|eod|end of week)\b/gi,
    /\bwithin\s+\d+\s+(hours|days|weeks)\b/gi,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:by|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\btonight\b/gi,
    /\btomorrow\b/gi,
    /\btoday\b/gi,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 8);
}

function extractMoneyMentions(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [/\$\s?\d[\d,]*(?:\.\d{2})?/g, /\bUSD\s?\d[\d,]*(?:\.\d{2})?\b/gi];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 8);
}

function extractUrls(raw: string): string[] {
  const out = new Set<string>();
  const re = /\bhttps?:\/\/[^\s)]+/gi;
  const m = raw.match(re);
  if (m) m.forEach((x) => out.add(x.trim()));
  return Array.from(out).slice(0, 10);
}

function extractDomainsFromUrls(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host) out.add(host);
    } catch {
      // ignore invalid URL
    }
  }
  return Array.from(out).slice(0, 10);
}

function extractAttachments(raw: string): { attachments: string[]; attachmentRiskScore: number } {
  const out = new Set<string>();
  const headerList = extractHeader(raw, "Attachments");
  if (headerList) {
    headerList
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => out.add(x));
  }

  const filePattern =
    /\b[a-zA-Z0-9._ -]+\.(pdf|doc|docx|docm|xls|xlsx|xlsm|csv|ppt|pptx|pptm|zip|rar|7z|exe|js|vbs|bat|cmd|scr|html|htm)\b/g;
  const matches = raw.match(filePattern);
  if (matches) {
    matches.forEach((m) => out.add(m.trim()));
  }

  const attachments = Array.from(out).slice(0, 12);
  let risk = 0;
  for (const name of attachments) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (HIGH_RISK_ATTACHMENT_EXT.has(ext)) risk += 26;
    else if (MEDIUM_RISK_ATTACHMENT_EXT.has(ext)) risk += 12;
  }
  if (attachments.length >= 4) risk += 6;

  return { attachments, attachmentRiskScore: clamp(risk, 0, 100) };
}

function createHashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function defaultTrustGraph(): TrustGraph {
  return { senders: {}, domains: {} };
}

function parseTrustNode(value: unknown): TrustNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Partial<TrustNode>;
  if (
    typeof node.seen !== "number" ||
    typeof node.high !== "number" ||
    typeof node.medium !== "number" ||
    typeof node.lastSeen !== "number"
  ) {
    return null;
  }
  return {
    seen: clamp(Math.round(node.seen), 0, 10000),
    high: clamp(Math.round(node.high), 0, 10000),
    medium: clamp(Math.round(node.medium), 0, 10000),
    lastSeen: node.lastSeen,
  };
}

function readTrustGraphCookie(cookieValue?: string): TrustGraph {
  if (!cookieValue) return defaultTrustGraph();
  try {
    const raw = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as {
      senders?: Record<string, unknown>;
      domains?: Record<string, unknown>;
    };

    const senders: Record<string, TrustNode> = {};
    const domains: Record<string, TrustNode> = {};

    for (const [k, v] of Object.entries(raw.senders || {})) {
      const node = parseTrustNode(v);
      if (node) senders[k] = node;
    }
    for (const [k, v] of Object.entries(raw.domains || {})) {
      const node = parseTrustNode(v);
      if (node) domains[k] = node;
    }

    return { senders, domains };
  } catch {
    return defaultTrustGraph();
  }
}

function pruneNodes(nodes: Record<string, TrustNode>, maxEntries: number): Record<string, TrustNode> {
  const entries = Object.entries(nodes).sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, maxEntries);
  return Object.fromEntries(entries);
}

function writeTrustGraphCookie(store: Awaited<ReturnType<typeof cookies>>, graph: TrustGraph): void {
  const payload = {
    senders: pruneNodes(graph.senders, 80),
    domains: pruneNodes(graph.domains, 80),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  store.set(TRUST_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUST_COOKIE_TTL_SECONDS,
  });
}

function trustScoreFromNode(node: TrustNode | null): number {
  if (!node) return 45;
  const recentDays = (Date.now() - node.lastSeen) / (1000 * 60 * 60 * 24);
  const recencyBoost = recentDays <= 14 ? 6 : recentDays <= 45 ? 2 : 0;
  const score =
    45 +
    Math.min(20, node.seen * 3.2) -
    Math.min(28, node.high * 7) -
    Math.min(10, node.medium * 2) +
    recencyBoost;
  return clamp(Math.round(score), 5, 95);
}

function getTrustScore(graph: TrustGraph, senderEmail: string, senderDomain: string): number {
  const senderNode = senderEmail ? graph.senders[createHashKey(`sender:${senderEmail}`)] : null;
  const domainNode = senderDomain ? graph.domains[createHashKey(`domain:${senderDomain}`)] : null;

  const senderScore = trustScoreFromNode(senderNode || null);
  const domainScore = trustScoreFromNode(domainNode || null);
  return clamp(Math.round(senderScore * 0.55 + domainScore * 0.45), 5, 95);
}

function updateTrustNode(node: TrustNode | undefined, priority: Priority): TrustNode {
  const base: TrustNode = node || { seen: 0, high: 0, medium: 0, lastSeen: Date.now() };
  return {
    seen: base.seen + 1,
    high: base.high + (priority === "high" ? 1 : 0),
    medium: base.medium + (priority === "medium" ? 1 : 0),
    lastSeen: Date.now(),
  };
}

function updateTrustGraph(graph: TrustGraph, senderEmail: string, senderDomain: string, priority: Priority): void {
  if (senderEmail) {
    const senderKey = createHashKey(`sender:${senderEmail}`);
    graph.senders[senderKey] = updateTrustNode(graph.senders[senderKey], priority);
  }
  if (senderDomain) {
    const domainKey = createHashKey(`domain:${senderDomain}`);
    graph.domains[domainKey] = updateTrustNode(graph.domains[domainKey], priority);
  }
}

function buildReputationProfile(args: {
  senderDomain: string;
  urlDomains: string[];
  orgDomains: string[];
  trustScore: number;
}): ReputationProfile {
  const domains = Array.from(new Set([args.senderDomain, ...args.urlDomains].filter(Boolean))).slice(0, 10);
  let risk = 0;
  const findings: string[] = [];

  if (!args.senderDomain) {
    risk += 20;
    findings.push("Sender domain could not be parsed.");
  }

  for (const domain of domains) {
    const lower = domain.toLowerCase();
    const tldHit = SUSPICIOUS_TLDS.some((tld) => lower.endsWith(tld));
    if (tldHit) {
      risk += 20;
      findings.push(`Suspicious top-level domain detected: ${lower}`);
    }
    if (lower.includes("xn--")) {
      risk += 18;
      findings.push(`Punycode/homograph pattern detected: ${lower}`);
    }
    const hyphenCount = (lower.match(/-/g) || []).length;
    if (hyphenCount >= 3) {
      risk += 8;
      findings.push(`Domain has many hyphens: ${lower}`);
    }
    const alnum = lower.replace(/[^a-z0-9]/g, "");
    const digitCount = (alnum.match(/[0-9]/g) || []).length;
    if (alnum.length > 0 && digitCount / alnum.length >= 0.3) {
      risk += 8;
      findings.push(`Domain contains unusually high numeric ratio: ${lower}`);
    }
    if (/(secure|verify|login|update|auth|billing|account|support)/i.test(lower)) {
      risk += 6;
      findings.push(`Domain uses impersonation-prone keywords: ${lower}`);
    }
  }

  const senderDomain = args.senderDomain.toLowerCase();
  const mismatchUrls = args.urlDomains.filter(
    (domain) => !domain.endsWith(senderDomain) && !senderDomain.endsWith(domain)
  );
  if (senderDomain && mismatchUrls.length > 0) {
    risk += 12;
    findings.push("Sender domain and linked domains are inconsistent.");
  }

  if (senderDomain && FREE_MAIL_DOMAINS.has(senderDomain)) {
    risk += 14;
    findings.push("Sender uses a free-mail domain for potentially business-critical communication.");
  }

  if (args.orgDomains.includes(senderDomain)) {
    risk -= 18;
    findings.push("Sender domain matches organization domain allowlist.");
  }

  if (args.trustScore >= 78) {
    risk -= 10;
    findings.push("Sender/domain has strong historical trust score.");
  } else if (args.trustScore <= 30) {
    risk += 10;
    findings.push("Sender/domain has low historical trust score.");
  }

  const score = clamp(100 - risk, 5, 98);
  return {
    score,
    findings: Array.from(new Set(findings)).slice(0, 8),
    domains,
  };
}

function buildThreadProfiles(parsed: ParsedEmail[]): Record<string, ThreadProfile> {
  const stats: Record<
    string,
    {
      count: number;
      riskHits: number;
      urgencyHits: number;
    }
  > = {};

  for (const email of parsed) {
    const text = `${email.subject}\n${email.body}`;
    const riskHits = countHits(text, [...PATTERNS.security, ...PATTERNS.payment, ...PATTERNS.legal]);
    const urgencyHitsRaw = countHits(text, PATTERNS.deadline);
    const promotionalContext = buildPromotionalContext({
      text,
      senderEmail: email.senderEmail,
      senderDomain: email.senderDomain,
      attachmentRiskScore: email.extracted.attachmentRiskScore,
      securityHits: countHits(text, PATTERNS.security),
      paymentHits: countHits(text, PATTERNS.payment),
      legalHits: countHits(text, PATTERNS.legal),
      impersonationHits: countHits(text, PATTERNS.impersonation),
      malwareHits: countHits(text, PATTERNS.malware),
      deadlineHits: urgencyHitsRaw,
    });
    const urgencyHits =
      promotionalContext.lowRiskPromotional && riskHits === 0
        ? promotionalContext.effectiveDeadlineHits
        : urgencyHitsRaw;
    const cur = stats[email.threadKey] || { count: 0, riskHits: 0, urgencyHits: 0 };
    cur.count += 1;
    cur.riskHits += riskHits;
    cur.urgencyHits += urgencyHits;
    stats[email.threadKey] = cur;
  }

  const out: Record<string, ThreadProfile> = {};
  for (const [key, value] of Object.entries(stats)) {
    const density = value.count > 0 ? clamp((value.riskHits + value.urgencyHits * 0.75) / (value.count * 6), 0, 1) : 0;
    out[key] = {
      key,
      depth: Math.max(1, value.count),
      riskDensity: Number(density.toFixed(2)),
    };
  }
  return out;
}

function buildCategoryScores(args: {
  text: string;
  senderEmail: string;
  senderDomain: string;
  externalSender: boolean;
  suspiciousDomain: boolean;
  extracted: ParsedEmail["extracted"];
  trustScore: number;
  reputationScore: number;
  thread: ThreadProfile;
}): CategoryScore[] {
  const securityHits = countHits(args.text, PATTERNS.security);
  const paymentHits = countHits(args.text, PATTERNS.payment);
  const legalHits = countHits(args.text, PATTERNS.legal);
  const deadlineHits = countHits(args.text, PATTERNS.deadline);
  const scheduleHits = countHits(args.text, PATTERNS.scheduling);
  const execHits = countHits(args.text, PATTERNS.executive);
  const supportHits = countHits(args.text, PATTERNS.support);
  const impersonationHits = countHits(args.text, PATTERNS.impersonation);
  const malwareHits = countHits(args.text, PATTERNS.malware);
  const promotionalContext = buildPromotionalContext({
    text: args.text,
    senderEmail: args.senderEmail,
    senderDomain: args.senderDomain,
    attachmentRiskScore: args.extracted.attachmentRiskScore,
    securityHits,
    paymentHits,
    legalHits,
    impersonationHits,
    malwareHits,
    deadlineHits,
  });
  const {
    salesHits,
    newsletterHits,
    promoUrgencyHits,
    senderPromoHits,
    promotionalConfidence,
    lowRiskPromotional,
    effectiveDeadlineHits,
  } = promotionalContext;

  const trustRisk = args.trustScore <= 35 ? 1 : 0;
  const reputationRisk = args.reputationScore <= 45 ? 1 : 0;

  const scamBecScore =
    execHits * 16 +
    effectiveDeadlineHits * 8 +
    impersonationHits * 18 +
    paymentHits * 7 +
    (args.externalSender ? 12 : 0) +
    (args.suspiciousDomain ? 10 : 0) +
    trustRisk * 10 +
    reputationRisk * 10 +
    args.thread.riskDensity * 12;

  const scamInvoiceScore =
    paymentHits * 18 +
    effectiveDeadlineHits * 7 +
    (args.extracted.moneyMentions.length > 0 ? 10 : 0) +
    impersonationHits * 6 +
    (args.externalSender ? 10 : 0) +
    (args.suspiciousDomain ? 8 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    args.thread.riskDensity * 10;

  const scamCredentialScore =
    securityHits * 18 +
    (args.extracted.urls.length > 0 ? 12 : 0) +
    (args.extracted.attachmentRiskScore > 30 ? 6 : 0) +
    (args.externalSender ? 10 : 0) +
    (args.suspiciousDomain ? 14 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    impersonationHits * 4 +
    args.thread.riskDensity * 10;

  const scamMalwareScore =
    malwareHits * 18 +
    args.extracted.attachmentRiskScore * 0.9 +
    (args.extracted.attachments.length > 0 ? 8 : 0) +
    (args.externalSender ? 8 : 0) +
    (args.suspiciousDomain ? 6 : 0) +
    trustRisk * 6 +
    args.thread.riskDensity * 8;

  const scamImpersonationScore =
    impersonationHits * 20 +
    execHits * 10 +
    (args.externalSender ? 12 : 0) +
    (args.suspiciousDomain ? 12 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    effectiveDeadlineHits * 6;

  const securityScore =
    securityHits * 17 +
    effectiveDeadlineHits * 5 +
    (args.extracted.urls.length > 0 ? 7 : 0) +
    (args.extracted.attachmentRiskScore > 30 ? 12 : 0) +
    (args.externalSender ? 9 : 0) +
    (args.suspiciousDomain ? 12 : 0) +
    trustRisk * 8 +
    reputationRisk * 9 +
    args.thread.riskDensity * 10;

  const financeScore =
    paymentHits * 16 +
    effectiveDeadlineHits * 6 +
    (args.extracted.moneyMentions.length > 0 ? 8 : 0) +
    (args.externalSender ? 8 : 0) +
    trustRisk * 6 +
    reputationRisk * 7 +
    args.thread.riskDensity * 8;

  const legalScore = legalHits * 16 + (args.extracted.deadlines.length > 0 ? 6 : 0) + args.thread.depth * 1.5;
  const deadlineScore =
    scheduleHits * 9 +
    effectiveDeadlineHits * 12 +
    args.thread.depth * 1.8 +
    args.thread.riskDensity * 7 -
    (lowRiskPromotional ? promotionalConfidence * 5 : 0);
  const executiveScore = execHits * 14 + effectiveDeadlineHits * 3 + (args.externalSender ? 3 : 0);
  const salesScore =
    salesHits * 12 +
    senderPromoHits * 10 +
    (newsletterHits > 0 ? 4 : 0) +
    (lowRiskPromotional ? promoUrgencyHits * 6 : 0) -
    securityHits * 3;
  const supportScore = supportHits * 13 + scheduleHits * 5;
  const newsletterScore =
    newsletterHits * 15 +
    senderPromoHits * 8 +
    (args.externalSender ? 2 : 0) +
    (lowRiskPromotional ? promoUrgencyHits * 5 : 0) -
    securityHits * 8 -
    paymentHits * 6 -
    effectiveDeadlineHits * 4;
  const generalScore = 14 + scheduleHits * 2 + (args.externalSender ? 1 : 0) - (lowRiskPromotional ? promotionalConfidence * 4 : 0);

  const categories: CategoryScore[] = [
    {
      category: "scam_bec",
      score: clamp(Math.round(scamBecScore), 0, 100),
      reason: `exec=${execHits}, impersonation=${impersonationHits}, urgency=${deadlineHits}`,
    },
    {
      category: "scam_invoice_fraud",
      score: clamp(Math.round(scamInvoiceScore), 0, 100),
      reason: `payment=${paymentHits}, moneyMentions=${args.extracted.moneyMentions.length}, urgency=${deadlineHits}`,
    },
    {
      category: "scam_credential_phishing",
      score: clamp(Math.round(scamCredentialScore), 0, 100),
      reason: `security=${securityHits}, urls=${args.extracted.urls.length}, suspiciousDomain=${args.suspiciousDomain}`,
    },
    {
      category: "scam_malware_attachment",
      score: clamp(Math.round(scamMalwareScore), 0, 100),
      reason: `malware=${malwareHits}, attachmentRisk=${args.extracted.attachmentRiskScore}`,
    },
    {
      category: "scam_impersonation",
      score: clamp(Math.round(scamImpersonationScore), 0, 100),
      reason: `impersonation=${impersonationHits}, executive=${execHits}, external=${args.externalSender}`,
    },
    {
      category: "security_phishing",
      score: clamp(Math.round(securityScore), 0, 100),
      reason: `security=${securityHits}, attachmentRisk=${args.extracted.attachmentRiskScore}, trust=${args.trustScore}, reputation=${args.reputationScore}`,
    },
    {
      category: "finance_payment",
      score: clamp(Math.round(financeScore), 0, 100),
      reason: `payment=${paymentHits}, moneyMentions=${args.extracted.moneyMentions.length}, threadDepth=${args.thread.depth}`,
    },
    {
      category: "legal_contract",
      score: clamp(Math.round(legalScore), 0, 100),
      reason: `legal=${legalHits}, deadlines=${args.extracted.deadlines.length}`,
    },
    {
      category: "deadline_scheduling",
      score: clamp(Math.round(deadlineScore), 0, 100),
      reason: `deadline/scheduling=${deadlineHits + scheduleHits}, threadDepth=${args.thread.depth}`,
    },
    {
      category: "executive_escalation",
      score: clamp(Math.round(executiveScore), 0, 100),
      reason: `executive=${execHits}`,
    },
    {
      category: "sales_marketing",
      score: clamp(Math.round(salesScore), 0, 100),
      reason: `sales=${salesHits}`,
    },
    {
      category: "ops_support",
      score: clamp(Math.round(supportScore), 0, 100),
      reason: `support=${supportHits}`,
    },
    {
      category: "newsletter",
      score: clamp(Math.round(newsletterScore), 0, 100),
      reason: `newsletter=${newsletterHits}`,
    },
    {
      category: "general",
      score: clamp(Math.round(generalScore), 0, 100),
      reason: "fallback category",
    },
  ];

  return categories.sort((a, b) => b.score - a.score);
}

function scoreOfCategory(categoryScores: CategoryScore[], category: Category): number {
  return categoryScores.find((entry) => entry.category === category)?.score ?? 0;
}

function isScamCategory(category: Category): boolean {
  return (
    category === "scam_bec" ||
    category === "scam_invoice_fraud" ||
    category === "scam_credential_phishing" ||
    category === "scam_malware_attachment" ||
    category === "scam_impersonation"
  );
}

function scoreEmail(args: {
  parsed: ParsedEmail;
  orgDomains: string[];
  trustScore: number;
  reputation: ReputationProfile;
  thread: ThreadProfile;
  incidentHints: IncidentHint[];
  temporalBoosts?: {
    urgencyDelta: number;
    threatDelta: number;
    flags: string[];
  };
}): ScoringSnapshot {
  const text = `${args.parsed.subject}\n${args.parsed.body}`;
  const securityHits = countHits(text, PATTERNS.security);
  const paymentHits = countHits(text, PATTERNS.payment);
  const legalHits = countHits(text, PATTERNS.legal);
  const deadlineHits = countHits(text, PATTERNS.deadline);
  const scheduleHits = countHits(text, PATTERNS.scheduling);
  const execHits = countHits(text, PATTERNS.executive);
  const impersonationHits = countHits(text, PATTERNS.impersonation);
  const supportHits = countHits(text, PATTERNS.support);
  const malwareHits = countHits(text, PATTERNS.malware);

  const suspiciousDomain =
    !!args.parsed.senderDomain && SUSPICIOUS_TLDS.some((tld) => args.parsed.senderDomain.endsWith(tld));
  const externalSender =
    !!args.parsed.senderDomain && !args.orgDomains.some((domain) => domain.toLowerCase() === args.parsed.senderDomain);
  const promotionalContext = buildPromotionalContext({
    text,
    senderEmail: args.parsed.senderEmail,
    senderDomain: args.parsed.senderDomain,
    attachmentRiskScore: args.parsed.extracted.attachmentRiskScore,
    securityHits,
    paymentHits,
    legalHits,
    impersonationHits,
    malwareHits,
    deadlineHits,
  });
  const effectiveDeadlineCount = promotionalContext.lowRiskPromotional
    ? Math.max(0, args.parsed.extracted.deadlines.length - promotionalContext.promoUrgencyHits)
    : args.parsed.extracted.deadlines.length;

  const categoryScores = buildCategoryScores({
    text,
    senderEmail: args.parsed.senderEmail,
    senderDomain: args.parsed.senderDomain,
    externalSender,
    suspiciousDomain,
    extracted: args.parsed.extracted,
    trustScore: args.trustScore,
    reputationScore: args.reputation.score,
    thread: args.thread,
  });

  const primaryCategory = categoryScores[0].score >= 18 ? categoryScores[0].category : "general";
  const scamBecScore = scoreOfCategory(categoryScores, "scam_bec");
  const scamInvoiceScore = scoreOfCategory(categoryScores, "scam_invoice_fraud");
  const scamCredentialScore = scoreOfCategory(categoryScores, "scam_credential_phishing");
  const scamMalwareScore = scoreOfCategory(categoryScores, "scam_malware_attachment");
  const scamImpersonationScore = scoreOfCategory(categoryScores, "scam_impersonation");
  const securityScore = scoreOfCategory(categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(categoryScores, "finance_payment");
  const legalScore = scoreOfCategory(categoryScores, "legal_contract");
  const newsletterScore = scoreOfCategory(categoryScores, "newsletter");

  const decisionImportance = buildDecisionImportanceProfile({
    primaryCategory,
    categoryScores: categoryScores.map((entry) => ({
      category: entry.category,
      score: entry.score,
    })),
    trustScore: args.trustScore,
    reputationScore: args.reputation.score,
    thread: args.thread,
    externalSender,
    suspiciousDomain,
    attachmentRiskScore: args.parsed.extracted.attachmentRiskScore,
    urlsCount: args.parsed.extracted.urls.length,
    deadlineCount: effectiveDeadlineCount,
    moneyMentionsCount: args.parsed.extracted.moneyMentions.length,
    signalCount:
      securityHits +
      paymentHits +
      legalHits +
      promotionalContext.effectiveDeadlineHits +
      execHits +
      impersonationHits,
    hitCounts: {
      deadline: promotionalContext.effectiveDeadlineHits,
      scheduling: scheduleHits,
      executive: execHits,
      support: supportHits,
    },
    text,
    incidentHints: args.incidentHints,
    temporalBoosts: args.temporalBoosts,
  });

  let priorityScore =
    6 +
    decisionImportance.threatScore * 0.34 +
    decisionImportance.urgencyScore * 0.33 +
    decisionImportance.relevanceScore * 0.19 +
    decisionImportance.opportunityScore * 0.15 -
    decisionImportance.noiseScore * 0.3;

  const verifyNowCombo =
    decisionImportance.threatScore >= 72 && decisionImportance.trustGapScore >= 55;
  const actNowCombo =
    decisionImportance.urgencyScore >= 70 && decisionImportance.relevanceScore >= 48;
  const valuableOpportunityCombo =
    decisionImportance.opportunityScore >= 62 &&
    decisionImportance.affinityScore >= 28 &&
    decisionImportance.threatScore < 58;
  const routineNoiseCombo =
    decisionImportance.noiseScore >= 74 &&
    decisionImportance.urgencyScore < 45 &&
    decisionImportance.threatScore < 50 &&
    decisionImportance.opportunityScore < 60;

  if (verifyNowCombo) priorityScore = Math.max(priorityScore, 84);
  if (actNowCombo) priorityScore = Math.max(priorityScore, 80);
  if (valuableOpportunityCombo) priorityScore = Math.max(priorityScore, 56);
  if (routineNoiseCombo) priorityScore = Math.min(priorityScore, 36);

  priorityScore = clamp(Math.round(priorityScore), 0, 100);

  const priority: Priority = priorityScore >= 80 ? "high" : priorityScore >= 50 ? "medium" : "low";

  const riskTags: string[] = [];
  if (scamBecScore >= 40) riskTags.push("BEC Scam");
  if (scamInvoiceScore >= 40) riskTags.push("Invoice Scam");
  if (scamCredentialScore >= 40) riskTags.push("Credential Phishing");
  if (scamMalwareScore >= 40) riskTags.push("Malware Risk");
  if (scamImpersonationScore >= 40) riskTags.push("Impersonation");
  if (securityScore >= 35) riskTags.push("Security");
  if (financeScore >= 35) riskTags.push("Payment");
  if (legalScore >= 35) riskTags.push("Legal");
  if (externalSender) riskTags.push("External Sender");
  if (suspiciousDomain) riskTags.push("Suspicious Domain");
  if (promotionalContext.effectiveDeadlineHits > 0) riskTags.push("Deadline Pressure");
  if (execHits > 0) riskTags.push("Executive Escalation");
  if (impersonationHits > 0) riskTags.push("Impersonation Language");
  if (args.parsed.extracted.attachmentRiskScore > 40) riskTags.push("Suspicious Attachment");
  if (args.reputation.score <= 45) riskTags.push("Weak Entity Reputation");
  if (args.trustScore <= 30) riskTags.push("Low Historical Trust");
  if (decisionImportance.trustGapScore >= 58) riskTags.push("Trust Gap");

  const signals: string[] = [];
  if (securityHits > 0) signals.push(`${securityHits} credential/authentication signal(s)`);
  if (paymentHits > 0) signals.push(`${paymentHits} payment/transfer signal(s)`);
  if (legalHits > 0) signals.push(`${legalHits} legal/contract signal(s)`);
  if (promotionalContext.effectiveDeadlineHits > 0) {
    signals.push(`${promotionalContext.effectiveDeadlineHits} urgency/deadline signal(s)`);
  }
  if (args.parsed.extracted.attachmentRiskScore > 0) {
    signals.push(`attachment risk score ${args.parsed.extracted.attachmentRiskScore}/100`);
  }
  if (externalSender) signals.push("sender appears external to organization domains");
  if (suspiciousDomain) signals.push("sender domain uses suspicious TLD pattern");
  if (verifyNowCombo) signals.push("verify-now pattern: high threat combined with trust gap");
  if (actNowCombo) signals.push("act-now pattern: urgency and relevance both elevated");
  if (valuableOpportunityCombo) signals.push("review-later pattern: likely valuable opportunity with prior affinity");
  if (routineNoiseCombo) signals.push("ignore-routine pattern: noise dominates action value");
  if (impersonationHits > 0) signals.push(`${impersonationHits} impersonation signal(s)`);
  if (args.thread.depth > 1) signals.push(`thread depth ${args.thread.depth} with risk density ${args.thread.riskDensity}`);
  if (newsletterScore >= 45) signals.push("newsletter/marketing signature detected");
  signals.push(
    `decision profile threat/urgency/relevance/opportunity/noise ${decisionImportance.threatScore}/${decisionImportance.urgencyScore}/${decisionImportance.relevanceScore}/${decisionImportance.opportunityScore}/${decisionImportance.noiseScore}`
  );
  if (decisionImportance.affinityScore >= 25) {
    signals.push(`historical affinity score ${decisionImportance.affinityScore}/100`);
  }

  return {
    priorityScore,
    priority,
    primaryCategory,
    categoryScores,
    riskTags: Array.from(new Set(riskTags)),
    signals: Array.from(new Set(signals)),
    trustScore: args.trustScore,
    reputation: args.reputation,
    thread: args.thread,
    decisionImportance,
    promotional: {
      lowRiskPromotional: promotionalContext.lowRiskPromotional,
      promotionalConfidence: promotionalContext.promotionalConfidence,
      promoUrgencyHits: promotionalContext.promoUrgencyHits,
      senderPromoHints: promotionalContext.senderPromoHits,
    },
  };
}

function computeBaseUncertainty(args: {
  rawEmail: string;
  priorityScore: number;
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
  categoryScores: CategoryScore[];
  trustScore: number;
  reputationScore: number;
  thread: ThreadProfile;
}): number {
  let uncertainty = 61;
  const rawLen = args.rawEmail.trim().length;

  if (rawLen > 1200) uncertainty -= 9;
  else if (rawLen < 170) uncertainty += 12;

  if (args.signals.length >= 5) uncertainty -= 12;
  else if (args.signals.length <= 1) uncertainty += 10;

  const evidenceCount =
    args.extracted.deadlines.length +
    args.extracted.moneyMentions.length +
    args.extracted.urls.length +
    args.extracted.attachments.length;
  if (evidenceCount >= 4) uncertainty -= 7;
  else if (evidenceCount === 0) uncertainty += 8;

  const top = args.categoryScores[0]?.score ?? 0;
  const second = args.categoryScores[1]?.score ?? 0;
  const spread = top - second;
  if (spread >= 18) uncertainty -= 9;
  else uncertainty += 6;
  if (top < 24) uncertainty += 9;

  if (args.thread.depth >= 3) uncertainty -= 4;
  if (args.thread.riskDensity >= 0.55) uncertainty -= 4;

  uncertainty += Math.round((50 - args.trustScore) * 0.08);
  uncertainty += Math.round((50 - args.reputationScore) * 0.1);

  if (args.priorityScore >= 80) uncertainty -= 4;
  if (args.riskTags.length === 0) uncertainty += 10;

  return clamp(Math.round(uncertainty), 5, 95);
}

function calibrateUncertainty(args: {
  category: Category;
  baseUncertaintyPercent: number;
  evidenceStrength: number;
  trustScore: number;
  reputationScore: number;
  consensusScore: number;
  threadDepth: number;
}): number {
  const profile = CALIBRATION_PROFILES[args.category];
  const baseConfidence = 100 - args.baseUncertaintyPercent;

  const evidenceConfidence = clamp(
    args.evidenceStrength * 0.55 +
      args.trustScore * 0.15 +
      args.reputationScore * 0.15 +
      args.consensusScore * 0.15,
    0,
    100
  );

  let calibratedConfidence =
    baseConfidence * profile.reliabilityWeight + evidenceConfidence * (1 - profile.reliabilityWeight);
  calibratedConfidence = calibratedConfidence * profile.slope + profile.offset;
  calibratedConfidence += Math.min(8, Math.max(0, args.threadDepth - 1) * 1.4);
  calibratedConfidence = clamp(calibratedConfidence, 2, 98);

  return clamp(Math.round(100 - calibratedConfidence), 2, 98);
}

type TrustedDecision = {
  action: TrustedDecisionAction;
  confidencePct: number;
  riskScore: number;
  note: string;
};

type AssistOutput = {
  suggestedAction: string;
  draftReply: string;
  consensusScore: number;
  consensusNote: string;
  agreement_scores: z.infer<typeof ConsensusAgreementScoresSchema>;
  disagreement_flags: string[];
  consensus_strength: number;
};

type AssistModelProvider = "openai" | "anthropic" | "google";

type AssistModelSpec = {
  provider: AssistModelProvider;
  model: string;
  style: string;
  displayName: string;
};

type AssistModelRun = {
  spec: AssistModelSpec;
  output: z.infer<typeof ConsensusModelOutputSchema> | null;
};

type SuccessfulAssistModelRun = {
  spec: AssistModelSpec;
  output: z.infer<typeof ConsensusModelOutputSchema>;
};

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function buildConsensusModelPool(consensusPolicy: InboxConsensusPolicy): AssistModelSpec[] {
  const candidates: AssistModelSpec[] = [];

  if (hasEnv("OPENAI_API_KEY")) {
    candidates.push(
      {
        provider: "openai",
        model: "gpt-4o-mini",
        style: "security-first",
        displayName: "GPT-4o mini",
      },
      {
        provider: "openai",
        model: "gpt-4.1-mini",
        style: "compliance-first",
        displayName: "GPT-4.1 mini",
      }
    );
  }

  if (hasEnv("GOOGLE_GENERATIVE_AI_API_KEY")) {
    candidates.push({
      provider: "google",
      model: "gemini-2.0-flash",
      style: "forensics-first",
      displayName: "Gemini 2.0 Flash",
    });
  }

  if (hasEnv("ANTHROPIC_API_KEY")) {
    candidates.push({
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      style: "policy-first",
      displayName: "Claude 3.5 Haiku",
    });
  }

  const maxModels = !consensusPolicy.enabled ? 1 : clamp(consensusPolicy.maxModels, 1, 8);

  return candidates.slice(0, maxModels);
}

function isSuccessfulAssistModelRun(run: AssistModelRun): run is SuccessfulAssistModelRun {
  return run.output !== null;
}

function formatModelNames(models: { displayName: string }[]): string {
  return models.map((m) => m.displayName).join(", ");
}

function applyDisagreementPenalty(baseUncertaintyPercent: number, flags: string[]): number {
  const severity = disagreementSeverity(flags);
  if (severity === "hard") return clamp(baseUncertaintyPercent + 12, 2, 98);
  if (severity === "moderate") return clamp(baseUncertaintyPercent + 6, 2, 98);
  return baseUncertaintyPercent;
}

function buildTrustedDecision(args: {
  email: ScoredEmail;
  uncertaintyPercent: number;
}): TrustedDecision {
  let riskScore = Math.round(
    args.email.decisionImportance.threatScore * 0.62 +
      args.email.decisionImportance.trustGapScore * 0.2 +
      (100 - args.email.trustScore) * 0.09 +
      (100 - args.email.reputation.score) * 0.09
  );

  if (isScamCategory(args.email.primaryCategory)) riskScore += 12;
  if (args.email.riskTags.includes("External Sender")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.senderMismatch;
  }
  if (
    args.email.riskTags.includes("Deadline Pressure") &&
    (args.email.decisionImportance.trustGapScore >= 45 ||
      args.email.decisionImportance.threatScore >= 60)
  ) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.urgentLanguage;
  }
  if (args.email.riskTags.includes("Payment") || args.email.riskTags.includes("Invoice Scam")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.paymentRequest;
  }
  if (args.email.riskTags.includes("Security") || args.email.riskTags.includes("Credential Phishing")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.credentialRequest;
  }
  if (args.email.extracted.urls.length > 0 && args.email.riskTags.includes("Suspicious Domain")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.suspiciousUrl;
  }
  if (args.email.extracted.attachmentRiskScore >= 30) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.suspiciousAttachment;
  }
  if (
    args.email.riskTags.includes("Impersonation") ||
    args.email.riskTags.includes("Executive Escalation") ||
    args.email.riskTags.includes("Impersonation Language")
  ) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.spoofingIndicators;
  }
  if (args.email.trustScore <= 35) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.lowHistoricalTrust;
  }

  riskScore = clamp(riskScore, 0, 100);

  let action: TrustedDecisionAction = "allow";
  if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.blockAtOrAbove) {
    action = "block";
  } else if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.quarantineAtOrAbove) {
    action = "quarantine";
  } else if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.escalateAtOrAbove) {
    action = "escalate";
  }

  const confidencePct = clamp(
    Math.round((100 - args.uncertaintyPercent) * 0.75 + Math.min(22, riskScore * 0.22)),
    5,
    99
  );

  let note = "Low-risk message. Allow with routine review.";
  if (action === "escalate") {
    note = "Medium risk detected. Escalate for human verification.";
  } else if (action === "quarantine") {
    note = "High risk detected. Quarantine until sender/request is verified.";
  } else if (action === "block") {
    note = "Critical scam indicators detected. Block and open security incident.";
  }

  return { action, confidencePct, riskScore, note };
}

function offlineAssistFromPolicy(args: {
  from: string;
  subject: string;
  trustedDecision: TrustedDecision;
  primaryCategory: Category;
  riskTags: string[];
}): AssistOutput {
  const identityStep =
    "verify sender identity using a known internal channel before any action on this request";
  const actionByCategory: Record<Category, string> = {
    scam_bec: `Potential BEC pattern detected; ${identityStep}.`,
    scam_invoice_fraud: `Potential invoice fraud pattern detected; ${identityStep}.`,
    scam_credential_phishing: `Potential credential phishing pattern detected; ${identityStep}.`,
    scam_malware_attachment: `Potential malware attachment pattern detected; isolate attachments and ${identityStep}.`,
    scam_impersonation: `Potential impersonation pattern detected; ${identityStep}.`,
    security_phishing: `Security risk signals detected; ${identityStep}.`,
    finance_payment: `Payment risk signals detected; confirm payment details through trusted channels.`,
    legal_contract: "Review legal terms with legal/compliance before replying.",
    deadline_scheduling: "Confirm deadlines and owners, then send a structured acknowledgement.",
    executive_escalation: "Validate executive request authenticity through known contacts.",
    sales_marketing: "Low-risk commercial message; proceed with normal qualification.",
    ops_support: "Operational support signal detected; route to support queue.",
    newsletter: "Likely newsletter/marketing communication; no sensitive action needed.",
    general: "General communication; request clarification if action is ambiguous.",
  };

  const action = actionByCategory[args.primaryCategory];
  const riskSummary = args.riskTags.slice(0, 4).join(", ") || "No high-risk tags";
  const suggestedAction = `${action} Decision: ${args.trustedDecision.action.toUpperCase()} (${args.trustedDecision.riskScore}/100 risk).`;

  const draftReply = `Hello,

Thank you for the message regarding "${args.subject}".
Before I proceed, I need to complete internal verification for sender identity and request details.
I will confirm next steps after verification is complete.

Regards`;

  return {
    suggestedAction,
    draftReply,
    consensusScore: args.trustedDecision.confidencePct,
    consensusNote: `Offline deterministic policy applied (${riskSummary}).`,
    agreement_scores: defaultAgreementScores(),
    disagreement_flags: ["offline_policy_applied"],
    consensus_strength: clamp(args.trustedDecision.confidencePct / 100, 0, 1),
  };
}

async function runAssistModel(args: {
  modelSpec: AssistModelSpec;
  rawEmail: string;
  from: string;
  subject: string;
  priority: Priority;
  priorityScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
}): Promise<AssistModelRun> {
  const prompt = `
You are an inbox triage assistant (${args.modelSpec.style}).
Use ONLY the email and provided signals.
Output strict JSON:
- suggestedAction: 1 concise sentence with safest next action.
- draftReply: 3-7 professional lines. If no response needed: "No reply needed."
- label: one of "spam", "harmful", "actionable", "informational".
- action: one of "allow", "escalate", "quarantine", "block".
- confidence: float between 0 and 1 for the model's own confidence.
- entities: list of important people, organizations, brands, domains, or products referenced in the email. Use [] if none.

FROM: ${args.from}
SUBJECT: ${args.subject}
PRIORITY: ${args.priority} (${args.priorityScore})
PRIMARY_CATEGORY: ${args.primaryCategory}
TOP_CATEGORY_SCORES: ${JSON.stringify(args.categoryScores.slice(0, 4))}
RISK_TAGS: ${JSON.stringify(args.riskTags)}
SIGNALS: ${JSON.stringify(args.signals)}
DEADLINES: ${JSON.stringify(args.extracted.deadlines)}
MONEY: ${JSON.stringify(args.extracted.moneyMentions)}
URLS: ${JSON.stringify(args.extracted.urls)}
ATTACHMENTS: ${JSON.stringify(args.extracted.attachments)}

EMAIL_RAW:
${args.rawEmail}
`;

  try {
    const model =
      args.modelSpec.provider === "openai"
        ? openai(args.modelSpec.model)
        : args.modelSpec.provider === "google"
          ? google(args.modelSpec.model)
          : anthropic(args.modelSpec.model);

    const obj = await generateObject({
      model,
      schema: ConsensusModelOutputSchema,
      prompt,
    });
    return { spec: args.modelSpec, output: obj.object };
  } catch {
    return { spec: args.modelSpec, output: null };
  }
}

async function llmAssistWithConsensus(args: {
  rawEmail: string;
  from: string;
  subject: string;
  priority: Priority;
  priorityScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
  consensusPolicy: InboxConsensusPolicy;
}) {
  const modelPool = buildConsensusModelPool(args.consensusPolicy);
  if (modelPool.length === 0) {
    return {
      suggestedAction: "Review the request and verify the sender before taking action.",
      draftReply: "Thanks for your email. I will verify details through a trusted channel and then confirm next steps.",
      consensusScore: 30,
      consensusNote:
        "No consensus models configured. Set OPENAI_API_KEY and optionally GOOGLE_GENERATIVE_AI_API_KEY / ANTHROPIC_API_KEY.",
      agreement_scores: defaultAgreementScores(),
      disagreement_flags: ["no_models_configured"],
      consensus_strength: 0.3,
    };
  }

  const runs = await Promise.all(modelPool.map((modelSpec) => runAssistModel({ ...args, modelSpec })));
  const successfulRuns = runs.filter(isSuccessfulAssistModelRun);

  if (successfulRuns.length === 0) {
    return {
      suggestedAction: "Review the request and verify the sender before taking action.",
      draftReply: "Thanks for your email. I will verify details through a trusted channel and then confirm next steps.",
      consensusScore: 30,
      consensusNote: `All configured reasoning models failed (${formatModelNames(modelPool)}); fallback response used.`,
      agreement_scores: defaultAgreementScores(),
      disagreement_flags: ["all_models_failed"],
      consensus_strength: 0.3,
    };
  }

  const evaluation = evaluateConsensusRuns({
    successfulRuns,
    totalModelCount: modelPool.length,
  });
  const successfulModelNames = formatModelNames(successfulRuns.map((r) => r.spec));
  const severity = disagreementSeverity(evaluation.disagreement_flags);

  if (successfulRuns.length === 1) {
    const partialFailureNote = evaluation.disagreement_flags.includes("partial_model_failure")
      ? " Some configured models failed, so disagreement handling increased uncertainty."
      : "";
    return {
      suggestedAction: evaluation.anchor.output.suggestedAction,
      draftReply: evaluation.anchor.output.draftReply,
      consensusScore: evaluation.consensusScore,
      consensusNote: `Single-model response (${successfulRuns[0].spec.displayName}). Enable consensus in Inbox settings to run multiple models.${partialFailureNote}`,
      agreement_scores: evaluation.agreement_scores,
      disagreement_flags: evaluation.disagreement_flags,
      consensus_strength: evaluation.consensus_strength,
    };
  }

  if (severity === "hard") {
    return {
      suggestedAction:
        "Model outputs disagree; verify sender identity and request details via a known trusted channel before responding.",
      draftReply:
        "Thank you for your message.\nBefore proceeding, I need to verify the request and sender details through a trusted channel.\nI will follow up once verification is complete.",
      consensusScore: evaluation.consensusScore,
      consensusNote: `Low agreement across ${successfulRuns.length} models (${successfulModelNames}); disagreement detected in labels or actions, so the conservative fallback response was used.`,
      agreement_scores: evaluation.agreement_scores,
      disagreement_flags: evaluation.disagreement_flags,
      consensus_strength: evaluation.consensus_strength,
    };
  }

  if (evaluation.highAgreement) {
    return {
      suggestedAction: evaluation.anchor.output.suggestedAction,
      draftReply: evaluation.anchor.output.draftReply,
      consensusScore: evaluation.consensusScore,
      consensusNote: `High agreement across ${successfulRuns.length} models (${successfulModelNames}).`,
      agreement_scores: evaluation.agreement_scores,
      disagreement_flags: evaluation.disagreement_flags,
      consensus_strength: evaluation.consensus_strength,
    };
  }

  return {
    suggestedAction: evaluation.anchor.output.suggestedAction,
    draftReply: evaluation.anchor.output.draftReply,
    consensusScore: evaluation.consensusScore,
    consensusNote: `Low agreement across ${successfulRuns.length} models (${successfulModelNames}); anchor response kept with disagreement warning.`,
    agreement_scores: evaluation.agreement_scores,
    disagreement_flags: evaluation.disagreement_flags,
    consensus_strength: evaluation.consensus_strength,
  };
}

async function getEmails(
  input: z.infer<typeof InboxRequestSchema>,
  requestUrl: URL,
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<string[]> {
  if (input.mode === "manual") return input.emails;

  const token = await getValidGmailToken(cookieStore, requestUrl);
  if (!token) {
    throw new Error("Gmail is not connected. Connect Gmail from Inbox Scanner first.");
  }

  return fetchLatestGmailRawEmails({
    accessToken: token.accessToken,
    maxResults: input.gmail?.maxResults ?? 20,
    query: input.gmail?.query || "in:inbox",
  });
}

function parseRawEmail(raw: string, id: string): ParsedEmail {
  const receivedAt = extractReceivedAt(raw);
  const from = extractFrom(raw);
  const subject = extractSubject(raw);
  const senderEmail = senderEmailFromFromHeader(from);
  const senderDomain = domainFromFromHeader(from);
  const body = extractBody(raw);

  const deadlines = extractDeadlines(raw);
  const moneyMentions = extractMoneyMentions(raw);
  const urls = extractUrls(raw);
  const urlDomains = extractDomainsFromUrls(urls);
  const { attachments, attachmentRiskScore } = extractAttachments(raw);
  const threadKey = deriveThreadKey(raw, subject, senderDomain);

  return {
    id,
    raw,
    receivedAt,
    from,
    subject,
    senderEmail,
    senderDomain,
    body,
    threadKey,
    extracted: {
      deadlines,
      moneyMentions,
      urls,
      attachments,
      attachmentRiskScore,
      urlDomains,
    },
  };
}

function buildMemoryRef(args: { raw: string; subject: string; senderEmail: string }) {
  return {
    sourceHash: createHashKey(`raw:${args.raw.slice(0, 2400)}`),
    subjectHash: createHashKey(`subject:${args.subject}`),
    senderEmailHash: args.senderEmail ? createHashKey(`sender:${args.senderEmail}`) : "",
  };
}

async function loadIncidentHints(parsedEmails: ParsedEmail[]): Promise<Record<string, IncidentHint[]>> {
  if (!process.env.MONGODB_URI || parsedEmails.length === 0) return {};

  try {
    await connectMongo();

    const senderDomains = Array.from(
      new Set(parsedEmails.map((email) => email.senderDomain).filter(Boolean))
    );
    const senderEmailHashes = Array.from(
      new Set(
        parsedEmails
          .map((email) => (email.senderEmail ? createHashKey(`sender:${email.senderEmail}`) : ""))
          .filter(Boolean)
      )
    );
    const subjectHashes = Array.from(
      new Set(parsedEmails.map((email) => createHashKey(`subject:${email.subject}`)))
    );

    const orFilters: Array<Record<string, unknown>> = [];
    if (senderDomains.length > 0) {
      orFilters.push({ senderDomain: { $in: senderDomains } });
    }
    if (senderEmailHashes.length > 0) {
      orFilters.push({ senderEmailHash: { $in: senderEmailHashes } });
    }
    if (subjectHashes.length > 0) {
      orFilters.push({ subjectHash: { $in: subjectHashes } });
    }

    if (orFilters.length === 0) return {};

    const rawDocs = (await IncidentMemoryModel.find({ $or: orFilters })
      .sort({ createdAt: -1 })
      .limit(800)
      .lean()
      .exec()) as unknown;

    if (!Array.isArray(rawDocs)) return {};

    const docs = rawDocs as Array<{
      senderDomain?: unknown;
      senderEmailHash?: unknown;
      subjectHash?: unknown;
      mailClass?: unknown;
      threatType?: unknown;
      trustedAction?: unknown;
      priorityScore?: unknown;
      outcomeLabel?: unknown;
    }>;

    const out: Record<string, IncidentHint[]> = {};

    for (const email of parsedEmails) {
      const senderEmailHash = email.senderEmail
        ? createHashKey(`sender:${email.senderEmail}`)
        : "";
      const subjectHash = createHashKey(`subject:${email.subject}`);

      const hints: IncidentHint[] = [];
      for (const doc of docs) {
        const docSenderDomain =
          typeof doc.senderDomain === "string" ? doc.senderDomain.toLowerCase() : "";
        const docSenderEmailHash =
          typeof doc.senderEmailHash === "string" ? doc.senderEmailHash : "";
        const docSubjectHash = typeof doc.subjectHash === "string" ? doc.subjectHash : "";

        const senderEmailMatch = Boolean(
          senderEmailHash && docSenderEmailHash === senderEmailHash
        );
        const senderDomainMatch = Boolean(
          email.senderDomain &&
            docSenderDomain &&
            docSenderDomain === email.senderDomain
        );
        const subjectMatch = Boolean(docSubjectHash && docSubjectHash === subjectHash);

        if (!senderEmailMatch && !senderDomainMatch && !subjectMatch) continue;

        const parsedMailClass = InboxMailClassEnum.safeParse(doc.mailClass);
        if (!parsedMailClass.success) continue;

        const parsedThreatType = InboxThreatTypeEnum.safeParse(doc.threatType);
        if (!parsedThreatType.success) continue;

        const parsedAction = TrustedDecisionActionEnum.safeParse(doc.trustedAction);

        hints.push({
          mailClass: parsedMailClass.data,
          threatType: parsedThreatType.data,
          trustedAction: parsedAction.success ? parsedAction.data : "allow",
          priorityScore:
            typeof doc.priorityScore === "number"
              ? clamp(Math.round(doc.priorityScore), 0, 100)
              : 50,
          outcomeLabel:
            typeof doc.outcomeLabel === "string" ? doc.outcomeLabel.trim() : "",
        });

        if (hints.length >= 24) break;
      }

      out[email.id] = hints;
    }

    return out;
  } catch (error) {
    console.warn("Incident hint loading skipped:", error);
    return {};
  }
}

async function persistInboxMemory(args: {
  alerts: Alert[];
  modelVersion: string;
  policyVersion: string;
}): Promise<void> {
  if (!process.env.MONGODB_URI) return;

  try {
    await connectMongo();

    const incidentDocs = args.alerts.slice(0, 40).map((alert) => ({
      sourceEmailId: alert.id,
      sourceHash: alert.memoryRef.sourceHash,
      senderDomain: alert.senderDomain,
      senderEmailHash: alert.memoryRef.senderEmailHash,
      subjectHash: alert.memoryRef.subjectHash,
      primaryCategory: alert.primaryCategory,
      mailClass: alert.mailClass,
      threatType: alert.threatType,
      trustedAction: alert.trustedDecision.action,
      priorityScore: alert.priorityScore,
      consensusScore: alert.consensusScore,
      riskTags: alert.riskTags.slice(0, 12),
      signals: alert.signals.slice(0, 12),
      uncertaintyScore: alert.uncertainty.score,
      uncertaintyTypes: alert.uncertainty.type.slice(0, 3),
      uncertaintySources: {
        modelConfidence: alert.uncertainty.sources.model_confidence,
        signalConflict: alert.uncertainty.sources.signal_conflict,
        missingFields: alert.uncertainty.sources.missing_fields,
      },
      deterministicSignals: {
        topCategoryScores: alert.signalGroups.deterministic.topCategoryScores.slice(0, 4),
        riskTags: alert.signalGroups.deterministic.riskTags.slice(0, 8),
        signals: alert.signalGroups.deterministic.signals.slice(0, 8),
        trustScore: alert.signalGroups.deterministic.trustScore,
        reputationScore: alert.signalGroups.deterministic.reputationScore,
        reputationFindings: alert.signalGroups.deterministic.reputationFindings.slice(0, 6),
        thread: alert.signalGroups.deterministic.thread,
        extractedCounts: alert.signalGroups.deterministic.extractedCounts,
        guardrails: {
          ruleHits: alert.signalGroups.deterministic.guardrails.ruleHits.slice(0, 6),
          rationale: alert.signalGroups.deterministic.guardrails.rationale,
        },
      },
      learnedSignals: {
        classifier: alert.signalGroups.learned.classifier,
        consensus: {
          score: alert.signalGroups.learned.consensus.score,
          note: alert.signalGroups.learned.consensus.note,
          strength: alert.signalGroups.learned.consensus.strength,
          agreementScores: alert.signalGroups.learned.consensus.agreementScores,
          disagreementFlags: alert.signalGroups.learned.consensus.disagreementFlags.slice(0, 6),
        },
      },
      explanationSummary: alert.explanation.summary,
      explanationKeyFactors: alert.explanation.keyFactors.slice(0, 5),
      evidenceRefs: alert.decisionTrace.evidenceRefs,
      policyVersion: args.policyVersion,
      modelVersion: args.modelVersion,
      outcomeLabel: "",
      feedbackSource: "inbox_scan",
    }));

    if (incidentDocs.length > 0) {
      await IncidentMemoryModel.insertMany(incidentDocs, { ordered: false });
    }

    const snapshotOps = args.alerts
      .filter((alert) => alert.senderDomain)
      .slice(0, 60)
      .map((alert) => ({
        updateOne: {
          filter: {
            senderDomain: alert.senderDomain,
            senderEmailHash: alert.senderEmail
              ? createHashKey(`sender:${alert.senderEmail}`)
              : "",
          },
          update: {
            $set: {
              trustScore: alert.trustScore,
              reputationScore: alert.reputationScore,
              lastSeenAt: new Date(),
            },
            $inc: {
              highCount: alert.priority === "high" ? 1 : 0,
              mediumCount: alert.priority === "medium" ? 1 : 0,
              lowCount: alert.priority === "low" ? 1 : 0,
              sampleSize: 1,
            },
            $addToSet: {
              notes: {
                $each: alert.riskTags.slice(0, 4),
              },
            },
          },
          upsert: true,
        },
      }));

    if (snapshotOps.length > 0) {
      await SenderReputationSnapshotModel.bulkWrite(snapshotOps, {
        ordered: false,
      });
    }
  } catch (error) {
    console.warn("Inbox memory persistence skipped:", error);
  }
}

async function persistInboxEvaluationLog(args: {
  alerts: Alert[];
  sourceMode: "manual" | "gmail";
  processingMode: "offline_enforced" | "hybrid_remote_llm";
  modelVersion: string;
  classifierVersion: string;
  policyVersion: string;
  consensusMode: "single" | "multi";
  consensusSource: "env_default" | "admin_override";
  consensusMaxModels: number;
  consensusModels: string[];
}): Promise<void> {
  try {
    const entries = args.alerts.map((alert) =>
      buildInboxEvaluationLogEntry({
        messageId: alert.id,
        prediction: alert.mailClass,
        rawPrediction: alert.classifier.predictedClass,
        confidence: alert.trustedDecision.confidencePct,
        rawModelConfidence: Math.max(
          alert.classifier.probabilities.spam,
          alert.classifier.probabilities.harmful,
          alert.classifier.probabilities.actionable,
          alert.classifier.probabilities.informational
        ),
        uncertainty: alert.uncertainty.score,
        uncertaintyPercent: alert.uncertaintyPercent,
        action: alert.trustedDecision.action,
        routingAction: alert.decision.final_action,
        consensusMode: args.consensusMode,
        consensusSource: args.consensusSource,
        consensusMaxModels: args.consensusMaxModels,
        consensusModels: args.consensusModels,
        consensusStrength: alert.consensus_strength,
        disagreementFlags: alert.disagreement_flags,
        sourceMode: args.sourceMode,
        processingMode: args.processingMode,
        modelVersion: args.modelVersion,
        classifierVersion: args.classifierVersion,
        policyVersion: args.policyVersion,
        groundTruth: buildGroundTruthPlaceholder(),
      })
    );

    await appendInboxEvaluationLogEntries(entries);
  } catch (error) {
    console.warn("Inbox evaluation logging skipped:", error);
  }
}

export async function POST(req: Request) {
  return withAegisWorkflowSpan(
    {
      name: "api.inbox.workflow",
      metadata: {
        surface: "inbox" as const,
        workflow_type: "inbox_scan" as const,
        endpoint: "api/inbox"
      }
    },
    async () => {
      try {
    const offlineConfig = getOfflineRuntimeConfig();
    const offlineEnforced = isOfflineEnforced(offlineConfig);

    const body = await req.json();
    const parsed = InboxRequestSchema.parse(body);
    const cookieStore = await cookies();
    const envConsensusPolicy = buildEnvConsensusPolicy();
    const adminSettings = parseInboxAdminSettingsCookie(
      cookieStore.get(INBOX_ADMIN_SETTINGS_COOKIE)?.value
    );
    const consensusPolicy = resolveConsensusPolicy({
      envPolicy: envConsensusPolicy,
      adminSettings,
    });
    const decisionPolicyConfig = buildEnvDecisionPolicyConfig();
    const adaptiveThresholdCache = await loadAdaptiveThresholds(
      process.env.AEGIS_DATA_DIR ?? "./data"
    );
    const effectiveThresholds = mergeAdaptiveThresholds({
      defaults: buildAdaptiveThresholdDefaults(decisionPolicyConfig),
      cached: adaptiveThresholdCache,
    });
    const effectiveDecisionPolicyConfig = buildEffectiveDecisionPolicyConfig(
      effectiveThresholds,
      decisionPolicyConfig
    );
    const selectedConsensusModels = buildConsensusModelPool(consensusPolicy).map(
      (spec) => `${spec.provider}:${spec.model}`
    );
    const modelVersion = inboxModelVersion({
      offlineEnforced,
      consensusPolicy,
    });

    if (offlineEnforced && parsed.mode === "gmail" && offlineConfig.blockOutboundNetwork) {
      return Response.json(
        {
          error: "Offline mode enforced",
          detail:
            "Gmail fetch is disabled in enforced offline mode because outbound network access is blocked. Use Manual mode.",
          offlineState: offlineConfig.state,
        },
        { status: 503 }
      );
    }

    const orgDomains = (parsed.userContext?.orgDomains || []).map((d) => d.toLowerCase());
    const emails = await getEmails(parsed, buildPublicRequestUrl(req), cookieStore);

    const parsedEmails = emails.map((raw, idx) => parseRawEmail(raw, `email-${idx + 1}`));
    parsedEmails.sort(
      (a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0)
    );
    const sortedEmails = parsedEmails;
    const threadProfiles = buildThreadProfiles(sortedEmails);
    const trustGraph = readTrustGraphCookie(cookieStore.get(TRUST_COOKIE)?.value);
    const incidentHintsByEmail = await loadIncidentHints(sortedEmails);
    const predictiveHistoryByEmail = await loadPredictiveSenderHistory(sortedEmails);

    const sessionMetaByEmailId: Record<string, SessionRecordMeta> = {};
    const sessionStore = buildSessionStore(
      sortedEmails.map((email) => {
        const trustScore = getTrustScore(trustGraph, email.senderEmail, email.senderDomain);
        const reputation = buildReputationProfile({
          senderDomain: email.senderDomain,
          urlDomains: email.extracted.urlDomains,
          orgDomains,
          trustScore,
        });
        const thread =
          threadProfiles[email.threadKey] || { key: email.threadKey, depth: 1, riskDensity: 0 };
        const preScoreText = `${email.subject}\n${email.body}`;
        const preScoreSuspiciousDomain =
          !!email.senderDomain &&
          SUSPICIOUS_TLDS.some((tld) => email.senderDomain.endsWith(tld));
        const preScoreExternalSender =
          !!email.senderDomain &&
          !orgDomains.some((domain) => domain.toLowerCase() === email.senderDomain);
        const preScoreCategoryScores = buildCategoryScores({
          text: preScoreText,
          senderEmail: email.senderEmail,
          senderDomain: email.senderDomain,
          externalSender: preScoreExternalSender,
          suspiciousDomain: preScoreSuspiciousDomain,
          extracted: email.extracted,
          trustScore,
          reputationScore: reputation.score,
          thread,
        });
        const topPreScoreCategory = preScoreCategoryScores[0];
        const preScorePrimaryCategory =
          topPreScoreCategory && topPreScoreCategory.score >= 18
            ? topPreScoreCategory.category
            : "general";

        sessionMetaByEmailId[email.id] = {
          senderDomainHash: hashSignal(email.senderDomain || ""),
          threadKeyHash: hashSignal(email.threadKey || ""),
          clusterKey: deriveClusterKey(
            email.extracted.moneyMentions,
            email.extracted.deadlines,
            preScorePrimaryCategory,
            email.body
          ),
          receivedAtMs: email.receivedAt?.getTime() ?? 0,
          preScorePrimaryCategory,
        };

        return {
          senderDomain: email.senderDomain,
          threadKey: email.threadKey,
          receivedAt: email.receivedAt,
          moneyMentions: email.extracted.moneyMentions,
          deadlines: email.extracted.deadlines,
          primaryCategory: preScorePrimaryCategory,
          body: email.body,
        };
      })
    );

    const scored: ScoredEmail[] = [];
    for (const email of sortedEmails) {
      const trustScore = getTrustScore(trustGraph, email.senderEmail, email.senderDomain);
      const reputation = buildReputationProfile({
        senderDomain: email.senderDomain,
        urlDomains: email.extracted.urlDomains,
        orgDomains,
        trustScore,
      });
      const thread = threadProfiles[email.threadKey] || { key: email.threadKey, depth: 1, riskDensity: 0 };
      const incidentHints = incidentHintsByEmail[email.id] || [];
      const receivedAt = email.receivedAt ?? new Date();
      const senderNode = email.senderEmail
        ? trustGraph.senders[createHashKey(`sender:${email.senderEmail}`)] || null
        : null;
      const domainNode = email.senderDomain
        ? trustGraph.domains[createHashKey(`domain:${email.senderDomain}`)] || null
        : null;
      const trustNodeForHistory = senderNode || domainNode;

      const s = scoreEmail({
        parsed: email,
        orgDomains,
        trustScore,
        reputation,
        thread,
        incidentHints,
      });
      const predictiveHistory = predictiveHistoryByEmail[email.id] || {
        subjectHashes: [],
        priorPriorityScores: [],
        outcomeLabels: [],
        avgResponseGapHours: null,
        lastEmailFromSender: null,
      };
      const urgencyPrediction = predictUrgency({
        email: {
          receivedAt,
          senderEmail: email.senderEmail,
          senderDomain: email.senderDomain,
          subject: email.subject,
          deadlines: email.extracted.deadlines,
          body: email.body,
        },
        trust: {
          senderScore: trustScoreFromNode(senderNode),
          seen: trustNodeForHistory?.seen ?? 0,
          lastSeen: trustNodeForHistory
            ? new Date(trustNodeForHistory.lastSeen)
            : null,
        },
        history: predictiveHistory,
        currentDecisionProfile: {
          urgency: s.decisionImportance.urgencyScore,
          relevance: s.decisionImportance.relevanceScore,
          threat: s.decisionImportance.threatScore,
        },
      });
      const decisionImportanceFromUrgency =
        urgencyPrediction.urgencyDelta !== 0
          ? rebalanceDecisionImportanceProfile({
              ...s.decisionImportance,
              urgencyScore: clamp(
                s.decisionImportance.urgencyScore + urgencyPrediction.urgencyDelta,
                0,
                100
              ),
            })
          : s.decisionImportance;
      const sessionMeta = sessionMetaByEmailId[email.id] ?? {
        senderDomainHash: hashSignal(email.senderDomain || ""),
        threadKeyHash: hashSignal(email.threadKey || ""),
        clusterKey: deriveClusterKey(
          email.extracted.moneyMentions,
          email.extracted.deadlines,
          s.primaryCategory,
          email.body
        ),
        receivedAtMs: receivedAt.getTime(),
        preScorePrimaryCategory: s.primaryCategory,
      };
      const preTemporalPriority = recomputePriorityFromDecisionProfile({
        decisionImportance: decisionImportanceFromUrgency,
        routineNoiseCap: effectiveThresholds.routineNoiseCap,
      });
      const temporalContext = buildTemporalContext({
        senderDomainHash: sessionMeta.senderDomainHash,
        threadKeyHash: sessionMeta.threadKeyHash,
        clusterKey: sessionMeta.clusterKey,
        receivedAt: sessionMeta.receivedAtMs,
        trustGraph: {
          senderScore: trustScore,
          seen: trustNodeForHistory?.seen ?? 0,
          lastSeen: trustNodeForHistory ? new Date(trustNodeForHistory.lastSeen) : null,
        },
        decisionProfile: {
          threat: decisionImportanceFromUrgency.threatScore,
          urgency: decisionImportanceFromUrgency.urgencyScore,
          primaryCategory: s.primaryCategory,
          attentionType: decisionImportanceFromUrgency.attentionType,
        },
        currentPriority: {
          priorityScore: preTemporalPriority.priorityScore,
          priorityBand: preTemporalPriority.priority,
        },
        store: sessionStore,
      });
      const decisionImportance =
        temporalContext.totalUrgencyDelta !== 0 || temporalContext.totalThreatDelta !== 0
          ? rebalanceDecisionImportanceProfile({
              ...decisionImportanceFromUrgency,
              urgencyScore: clamp(
                decisionImportanceFromUrgency.urgencyScore + temporalContext.totalUrgencyDelta,
                0,
                100
              ),
              threatScore: clamp(
                decisionImportanceFromUrgency.threatScore + temporalContext.totalThreatDelta,
                0,
                100
              ),
            })
          : decisionImportanceFromUrgency;
      const rescoredPriority = recomputePriorityFromDecisionProfile({
        decisionImportance,
        routineNoiseCap: effectiveThresholds.routineNoiseCap,
      });
      const urgencySignals = [
        ...temporalContext.temporalFlags,
        `temporal_context:${urgencyPrediction.temporalContext}`,
        `urgency_prediction:${urgencyPrediction.predictedUrgencyScore}/100 delta=${urgencyPrediction.urgencyDelta} confidence=${urgencyPrediction.predictionConfidence}/100`,
        ...urgencyPrediction.predictionFactors.map(
          (factor) =>
            `urgency_factor:${factor.factor}:${factor.direction}:${factor.magnitude}:${factor.rationale}`
        ),
        ...(rescoredPriority.routineNoiseApplied
          ? [`adaptive routine-noise cap ${effectiveThresholds.routineNoiseCap}`]
          : []),
      ];
      const classifier = classifyInboxMail({
        primaryCategory: s.primaryCategory,
        categoryScores: s.categoryScores.map((entry) => ({
          category: entry.category,
          score: entry.score,
        })),
        riskTags: s.riskTags,
        signals: Array.from(new Set([...s.signals, ...urgencySignals])),
        trustScore: s.trustScore,
        reputationScore: s.reputation.score,
        threadDepth: s.thread.depth,
        threadRiskDensity: s.thread.riskDensity,
        attachmentRiskScore: email.extracted.attachmentRiskScore,
        urlsCount: email.extracted.urls.length,
        moneyMentionsCount: email.extracted.moneyMentions.length,
        deadlineCount: email.extracted.deadlines.length,
        incidentHints,
        decisionImportance,
      });

      const priorityGuardrail = applyPriorityGuardrails({
        primaryCategory: s.primaryCategory,
        categoryScores: s.categoryScores.map((entry) => ({
          category: entry.category,
          score: entry.score,
        })),
        priorityScore: rescoredPriority.priorityScore,
        deadlineCount: email.extracted.deadlines.length,
        signals: Array.from(new Set([...s.signals, ...urgencySignals])),
        trustScore: s.trustScore,
        reputationScore: s.reputation.score,
        attachmentRiskScore: email.extracted.attachmentRiskScore,
        urlsCount: email.extracted.urls.length,
        classifier,
        decisionImportance,
      });
      const adaptivePriority = applyAdaptivePriorityCalibration({
        baseScore: priorityGuardrail.priorityScore,
        primaryCategory: s.primaryCategory,
        categoryScores: s.categoryScores,
        classifier,
        decisionImportance,
        deadlineCount: email.extracted.deadlines.length,
        attachmentRiskScore: email.extracted.attachmentRiskScore,
        urlsCount: email.extracted.urls.length,
        trustScore: s.trustScore,
        reputationScore: s.reputation.score,
        thresholds: effectiveThresholds,
      });
      const categoryScores = Object.fromEntries(
        s.categoryScores.map((entry) => [entry.category, entry.score])
      );

      const guardrailTags = [
        ...priorityGuardrail.ruleHits.map((rule) => `Guardrail:${rule}`),
        ...adaptivePriority.ruleHits.map((rule) => `Guardrail:${rule}`),
      ];
      const riskTags = Array.from(new Set([...s.riskTags, ...guardrailTags]));
      const signals = Array.from(
        new Set([
          ...s.signals,
          ...urgencySignals,
          `classifier predicted ${classifier.predictedClass}`,
          `classifier probs spam/harmful/actionable/info ${Math.round(
            classifier.probabilities.spam * 100
          )}/${Math.round(classifier.probabilities.harmful * 100)}/${Math.round(
            classifier.probabilities.actionable * 100
          )}/${Math.round(classifier.probabilities.informational * 100)}`,
          ...(priorityGuardrail.adjusted ? [priorityGuardrail.rationale] : []),
          ...(adaptivePriority.adjusted ? [adaptivePriority.rationale] : []),
        ])
      );

      const evidenceStrength = clamp(
        Math.round(
          s.categoryScores[0].score * 0.65 +
            (signals.length * 4 + riskTags.length * 3)
        ),
        0,
        100
      );
      const baseUncertaintyPercent = computeBaseUncertainty({
        rawEmail: email.raw,
        priorityScore: adaptivePriority.priorityScore,
        riskTags,
        signals,
        extracted: email.extracted,
        categoryScores: s.categoryScores,
        trustScore: s.trustScore,
        reputationScore: s.reputation.score,
        thread: s.thread,
      });
      const falsePositiveGuard = applyFalsePositiveGuard({
        rawPriorityScore: adaptivePriority.priorityScore,
        priorityBand: adaptivePriority.priority,
        primaryCategory: s.primaryCategory,
        categoryScores,
        riskTags,
        signals,
        decisionProfile: {
          threat: decisionImportance.threatScore,
          urgency: decisionImportance.urgencyScore,
          relevance: decisionImportance.relevanceScore,
          opportunity: decisionImportance.opportunityScore,
          noise: decisionImportance.noiseScore,
          trustGap: decisionImportance.trustGapScore,
          affinity: decisionImportance.affinityScore,
          attentionType: decisionImportance.attentionType,
        },
        email: {
          receivedAt: email.receivedAt,
          senderEmail: email.senderEmail,
          senderDomain: email.senderDomain,
          deadlines: email.extracted.deadlines,
          moneyMentions: email.extracted.moneyMentions,
          attachmentRiskScore: email.extracted.attachmentRiskScore,
          urlCount: email.extracted.urls.length,
          threadDepth: thread.depth,
          body: email.body,
        },
        trust: {
          senderScore: trustScoreFromNode(senderNode),
          domainScore: trustScoreFromNode(domainNode),
          seen: trustNodeForHistory?.seen ?? 0,
          highCount: trustNodeForHistory?.high ?? 0,
          mediumCount: trustNodeForHistory?.medium ?? 0,
          lastSeen: trustNodeForHistory ? new Date(trustNodeForHistory.lastSeen) : null,
        },
        history: {
          outcomeLabels: incidentHints
            .map((hint) => hint.outcomeLabel)
            .filter(Boolean),
          priorPriorityScores: incidentHints.map((hint) => hint.priorityScore),
          memorySampleCount: incidentHints.length,
        },
        promotional: s.promotional,
        classifier: {
          spamProbability: classifier.probabilities.spam,
          harmfulProbability: classifier.probabilities.harmful,
          actionableProbability: classifier.probabilities.actionable,
          informationalProbability: classifier.probabilities.informational,
        },
      });
      const falsePositiveGuardSignals = falsePositiveGuard.corrections.map(
        (correction) =>
          `false-positive guard ${correction.rule} ${correction.delta}: ${correction.reason}`
      );
      const falsePositiveGuardTags = falsePositiveGuard.corrections.map(
        (correction) => `FPGuard:${correction.rule}`
      );
      const finalRiskTags = Array.from(
        new Set([...riskTags, ...falsePositiveGuardTags])
      );
      const finalSignals = Array.from(
        new Set([...signals, ...falsePositiveGuardSignals])
      );
      const scoredEmail: ScoredEmail = {
        ...email,
        ...s,
        priorityScore: falsePositiveGuard.correctedScore,
        priority: falsePositiveGuard.correctedBand,
        riskTags: finalRiskTags,
        signals: finalSignals,
        decisionImportance,
        classifier,
        incidentHints,
        temporalContext,
        urgencyPrediction,
        priorityGuardrail: {
          adjusted: priorityGuardrail.adjusted || adaptivePriority.adjusted,
          ruleHits: [...priorityGuardrail.ruleHits, ...adaptivePriority.ruleHits],
          rationale: [
            priorityGuardrail.rationale,
            ...(adaptivePriority.adjusted ? [adaptivePriority.rationale] : []),
          ]
            .filter(Boolean)
            .join(" "),
        },
        baseUncertaintyPercent,
        evidenceStrength,
        falsePositiveGuard,
      };
      const sessionGuardedBaseUncertaintyPercent = clamp(
        baseUncertaintyPercent + falsePositiveGuard.confidenceAdjustment,
        0,
        100
      );
      const sessionTrustedDecision = buildTrustedDecision({
        email: scoredEmail,
        uncertaintyPercent: sessionGuardedBaseUncertaintyPercent,
      });
      const sessionRoutingDecision = applyRoutingOverride({
        decision: routeInboxDecision({
          confidencePct: sessionTrustedDecision.confidencePct,
          uncertaintyPercent: sessionGuardedBaseUncertaintyPercent,
          riskScore: sessionTrustedDecision.riskScore,
          disagreementFlags: [],
          config: effectiveDecisionPolicyConfig,
        }),
        override: temporalContext.routingOverride,
        reason: temporalContext.unresolvedThread.routingOverride
          ? `Temporal context override: ${temporalContext.unresolvedThread.rationale}`
          : temporalContext.routingOverride
            ? `Temporal context override: ${temporalContext.convergingSignal.rationale}`
            : "",
      });
      updateRecord(
        sessionStore,
        sessionMeta.senderDomainHash,
        sessionMeta.threadKeyHash,
        sessionMeta.receivedAtMs,
        {
          priorityScore: scoredEmail.priorityScore,
          priorityBand: scoredEmail.priority,
          primaryCategory: scoredEmail.primaryCategory,
          threatScore: decisionImportance.threatScore,
          urgencyScore: decisionImportance.urgencyScore,
          attentionType: decisionImportance.attentionType,
          trustedAction: sessionTrustedDecision.action,
          routingAction: sessionRoutingDecision.final_action,
          fpGuardActivated: falsePositiveGuard.guardActivated,
          fpGuardDelta: falsePositiveGuard.corrections.reduce(
            (sum, correction) => sum + correction.delta,
            0
          ),
        }
      );

      scored.push(scoredEmail);
    }

    scored.sort((a, b) => b.priorityScore - a.priorityScore);
    const TOP_N = offlineEnforced ? scored.length : Math.min(8, scored.length);

    const alerts: Alert[] = await Promise.all(
      scored.slice(0, TOP_N).map(async (email) => {
        const seedDecision = buildTrustedDecision({
          email,
          uncertaintyPercent: email.baseUncertaintyPercent,
        });
        const seedActionGuardrail = applyActionGuardrails({
          currentAction: seedDecision.action,
          primaryCategory: email.primaryCategory,
          categoryScores: email.categoryScores.map((entry) => ({
            category: entry.category,
            score: entry.score,
          })),
          attachmentRiskScore: email.extracted.attachmentRiskScore,
          urlsCount: email.extracted.urls.length,
          classifier: email.classifier,
        });
        const seedDecisionGuarded: TrustedDecision = {
          ...seedDecision,
          action: seedActionGuardrail.action,
          note: seedActionGuardrail.adjusted
            ? `${seedDecision.note} ${seedActionGuardrail.note}`
            : seedDecision.note,
        };

        const llm = offlineEnforced
          ? offlineAssistFromPolicy({
              from: email.from,
              subject: email.subject,
              trustedDecision: seedDecisionGuarded,
              primaryCategory: email.primaryCategory,
              riskTags: email.riskTags,
            })
          : await llmAssistWithConsensus({
              rawEmail: email.raw,
              from: email.from,
              subject: email.subject,
              priority: email.priority,
              priorityScore: email.priorityScore,
              primaryCategory: email.primaryCategory,
              categoryScores: email.categoryScores,
              riskTags: email.riskTags,
              signals: email.signals,
              extracted: email.extracted,
              consensusPolicy,
            });

        const guardedBaseUncertaintyPercent = clamp(
          email.baseUncertaintyPercent + email.falsePositiveGuard.confidenceAdjustment,
          0,
          100
        );
        const uncertaintyPercentBase = calibrateUncertainty({
          category: email.primaryCategory,
          baseUncertaintyPercent: guardedBaseUncertaintyPercent,
          evidenceStrength: email.evidenceStrength,
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          consensusScore: llm.consensusScore,
          threadDepth: email.thread.depth,
        });
        const uncertaintyPercent = applyDisagreementPenalty(
          uncertaintyPercentBase,
          llm.disagreement_flags
        );
        const trustedDecisionRaw = buildTrustedDecision({ email, uncertaintyPercent });
        const actionGuardrail = applyActionGuardrails({
          currentAction: trustedDecisionRaw.action,
          primaryCategory: email.primaryCategory,
          categoryScores: email.categoryScores.map((entry) => ({
            category: entry.category,
            score: entry.score,
          })),
          attachmentRiskScore: email.extracted.attachmentRiskScore,
          urlsCount: email.extracted.urls.length,
          classifier: email.classifier,
        });
        const trustedDecision: TrustedDecision = {
          ...trustedDecisionRaw,
          action: actionGuardrail.action,
          note: actionGuardrail.adjusted
            ? `${trustedDecisionRaw.note} ${actionGuardrail.note}`
            : trustedDecisionRaw.note,
        };
        const finalAssist = offlineEnforced
          ? offlineAssistFromPolicy({
              from: email.from,
              subject: email.subject,
              trustedDecision,
              primaryCategory: email.primaryCategory,
              riskTags: email.riskTags,
            })
          : llm;

        const derivedThreatType: InboxThreatType = deriveThreatType({
          primaryCategory: email.primaryCategory,
          riskTags: email.riskTags,
        });
        const derivedMailClass: InboxMailClass = deriveMailClass({
          primaryCategory: email.primaryCategory,
          threatType: derivedThreatType,
          priorityScore: email.priorityScore,
          trustedAction: trustedDecision.action,
          riskTags: email.riskTags,
        });
        const classReconcile = reconcileMailClass({
          primaryCategory: email.primaryCategory,
          derivedMailClass,
          derivedThreatType,
          classifier: email.classifier,
          priorityScore: email.priorityScore,
          decisionImportance: email.decisionImportance,
        });

        const policyRuleHits = Array.from(
          new Set([
            ...email.priorityGuardrail.ruleHits,
            ...email.falsePositiveGuard.corrections.map((correction) => correction.rule),
            ...actionGuardrail.ruleHits,
            ...classReconcile.ruleHits,
          ])
        );
        const policyRationale = [
          email.priorityGuardrail.rationale,
          ...email.falsePositiveGuard.corrections.map((correction) => correction.reason),
          actionGuardrail.note,
          classReconcile.rationale,
        ]
          .filter(Boolean)
          .join(" ");
        const decisionRiskTags = Array.from(
          new Set([...email.riskTags, ...policyRuleHits.map((rule) => `Policy:${rule}`)])
        );
        const decisionSignals = Array.from(
          new Set([...email.signals, ...(classReconcile.adjusted ? [classReconcile.rationale] : [])])
        );
        const signalGroups = buildSignalGroups({
          categoryScores: email.categoryScores,
          riskTags: decisionRiskTags,
          signals: decisionSignals,
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          reputationFindings: email.reputation.findings,
          thread: email.thread,
          extracted: email.extracted,
          guardrails: {
            ruleHits: policyRuleHits,
            rationale: policyRationale,
          },
          decisionImportance: email.decisionImportance,
          classifier: email.classifier,
          consensus: {
            score: finalAssist.consensusScore,
            note: finalAssist.consensusNote,
            strength: finalAssist.consensus_strength,
            agreementScores: finalAssist.agreement_scores,
            disagreementFlags: finalAssist.disagreement_flags,
          },
        });
        const uncertainty = buildStructuredUncertainty({
          uncertaintyPercent,
          categoryScores: email.categoryScores,
          classifier: email.classifier,
          finalMailClass: classReconcile.mailClass,
          senderEmail: email.senderEmail,
          senderDomain: email.senderDomain,
          rawEmail: email.raw,
          extracted: email.extracted,
          consensusStrength: finalAssist.consensus_strength,
          disagreementFlags: finalAssist.disagreement_flags,
        });
        const explanation = buildExplanation({
          primaryCategory: email.primaryCategory,
          priorityScore: email.priorityScore,
          trustedDecision,
          signalGroups,
          uncertainty,
        });
        const routedDecision = routeInboxDecision({
          confidencePct: trustedDecision.confidencePct,
          uncertaintyPercent,
          riskScore: trustedDecision.riskScore,
          disagreementFlags: finalAssist.disagreement_flags,
          config: effectiveDecisionPolicyConfig,
        });
        const decision = applyRoutingOverride({
          decision: routedDecision,
          override: email.temporalContext.routingOverride,
          reason: email.temporalContext.unresolvedThread.routingOverride
            ? `Temporal context override: ${email.temporalContext.unresolvedThread.rationale}`
            : email.temporalContext.routingOverride
              ? `Temporal context override: ${email.temporalContext.convergingSignal.rationale}`
              : routedDecision.reason,
        });
        const temporalRoutingNote = email.temporalContext.routingOverride
          ? ` Routing elevated by temporal context: ${email.temporalContext.temporalFlags
              .filter((flag) => flag.startsWith("temporal:routing"))
              .join(", ")}.`
          : "";
        const decisionTrace = {
          ...buildDecisionTrace({
            primaryCategory: email.primaryCategory,
            priorityScore: email.priorityScore,
            trustedAction: trustedDecision.action,
            riskTags: decisionRiskTags,
            topCategoryScores: email.categoryScores.slice(0, 4).map((entry) => ({
              category: entry.category,
              score: entry.score,
            })),
            trustScore: email.trustScore,
            reputationScore: email.reputation.score,
            threadDepth: email.thread.depth,
            threadRiskDensity: email.thread.riskDensity,
            consensusScore: finalAssist.consensusScore,
            policyVersion: INBOX_POLICY_VERSION,
            modelVersion,
          }),
          explanation: `${explanation.summary}${temporalRoutingNote}`,
        };

        const memoryRef = buildMemoryRef({
          raw: email.raw,
          subject: email.subject,
          senderEmail: email.senderEmail,
        });

        return {
          id: email.id,
          from: email.from,
          senderEmail: email.senderEmail || "",
          senderDomain: email.senderDomain || "",
          subject: email.subject,
          priorityScore: email.priorityScore,
          priority: email.priority,
          primaryCategory: email.primaryCategory,
          mailClass: classReconcile.mailClass,
          threatType: classReconcile.threatType,
          decisionTrace,
          categoryScores: email.categoryScores,
          riskTags: decisionRiskTags,
          signals: decisionSignals,
          signalGroups,
          uncertainty,
          explanation,
          decision,
          suggestedAction: finalAssist.suggestedAction,
          draftReply: finalAssist.draftReply,
          consensusScore: finalAssist.consensusScore,
          consensusNote: finalAssist.consensusNote,
          agreement_scores: finalAssist.agreement_scores,
          disagreement_flags: finalAssist.disagreement_flags,
          consensus_strength: finalAssist.consensus_strength,
          trustedDecision,
          classifier: email.classifier,
          guardrails: {
            policyVersion: INBOX_POLICY_VERSION,
            ruleHits: policyRuleHits,
            rationale: policyRationale,
            priorityAdjusted:
              email.priorityGuardrail.adjusted || email.falsePositiveGuard.guardActivated,
            actionAdjusted: actionGuardrail.adjusted,
            classificationAdjusted: classReconcile.adjusted,
          },
          memoryRef,
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          reputationFindings: email.reputation.findings,
          thread: email.thread,
          uncertaintyPercent,
          baseUncertaintyPercent: guardedBaseUncertaintyPercent,
          rawEmail: email.raw,
          extracted: {
            deadlines: email.extracted.deadlines,
            moneyMentions: email.extracted.moneyMentions,
            urls: email.extracted.urls,
            attachments: email.extracted.attachments,
            attachmentRiskScore: email.extracted.attachmentRiskScore,
          },
        };
      })
    );

    for (let i = TOP_N; i < scored.length; i++) {
      const email = scored[i];
      const guardedBaseUncertaintyPercent = clamp(
        email.baseUncertaintyPercent + email.falsePositiveGuard.confidenceAdjustment,
        0,
        100
      );
      const uncertaintyPercent = calibrateUncertainty({
        category: email.primaryCategory,
        baseUncertaintyPercent: guardedBaseUncertaintyPercent,
        evidenceStrength: email.evidenceStrength,
        trustScore: email.trustScore,
        reputationScore: email.reputation.score,
        consensusScore: 50,
        threadDepth: email.thread.depth,
      });
      const trustedDecisionRaw = buildTrustedDecision({ email, uncertaintyPercent });
      const actionGuardrail = applyActionGuardrails({
        currentAction: trustedDecisionRaw.action,
        primaryCategory: email.primaryCategory,
        categoryScores: email.categoryScores.map((entry) => ({
          category: entry.category,
          score: entry.score,
        })),
        attachmentRiskScore: email.extracted.attachmentRiskScore,
        urlsCount: email.extracted.urls.length,
        classifier: email.classifier,
      });
      const trustedDecision: TrustedDecision = {
        ...trustedDecisionRaw,
        action: actionGuardrail.action,
        note: actionGuardrail.adjusted
          ? `${trustedDecisionRaw.note} ${actionGuardrail.note}`
          : trustedDecisionRaw.note,
      };
      const derivedThreatType: InboxThreatType = deriveThreatType({
        primaryCategory: email.primaryCategory,
        riskTags: email.riskTags,
      });
      const derivedMailClass: InboxMailClass = deriveMailClass({
        primaryCategory: email.primaryCategory,
        threatType: derivedThreatType,
        priorityScore: email.priorityScore,
        trustedAction: trustedDecision.action,
        riskTags: email.riskTags,
      });
      const classReconcile = reconcileMailClass({
        primaryCategory: email.primaryCategory,
        derivedMailClass,
        derivedThreatType,
        classifier: email.classifier,
        priorityScore: email.priorityScore,
        decisionImportance: email.decisionImportance,
      });
      const policyRuleHits = Array.from(
        new Set([
          ...email.priorityGuardrail.ruleHits,
          ...email.falsePositiveGuard.corrections.map((correction) => correction.rule),
          ...actionGuardrail.ruleHits,
          ...classReconcile.ruleHits,
        ])
      );
      const decisionRiskTags = Array.from(
        new Set([...email.riskTags, ...policyRuleHits.map((rule) => `Policy:${rule}`)])
      );
      const decisionSignals = Array.from(
        new Set([...email.signals, ...(classReconcile.adjusted ? [classReconcile.rationale] : [])])
      );
      const signalGroups = buildSignalGroups({
        categoryScores: email.categoryScores,
        riskTags: decisionRiskTags,
        signals: decisionSignals,
        trustScore: email.trustScore,
        reputationScore: email.reputation.score,
        reputationFindings: email.reputation.findings,
        thread: email.thread,
        extracted: email.extracted,
        guardrails: {
          ruleHits: policyRuleHits,
          rationale: [
            email.priorityGuardrail.rationale,
            ...email.falsePositiveGuard.corrections.map((correction) => correction.reason),
            actionGuardrail.note,
            classReconcile.rationale,
          ]
            .filter(Boolean)
            .join(" "),
        },
        decisionImportance: email.decisionImportance,
        classifier: email.classifier,
        consensus: {
          score: 50,
          note: "Not passed through multi-model draft analysis due to TOP_N budget.",
          strength: 0.5,
          agreementScores: defaultAgreementScores(),
          disagreementFlags: ["not_analyzed_budget_capped"],
        },
      });
      const uncertainty = buildStructuredUncertainty({
        uncertaintyPercent,
        categoryScores: email.categoryScores,
        classifier: email.classifier,
        finalMailClass: classReconcile.mailClass,
        senderEmail: email.senderEmail,
        senderDomain: email.senderDomain,
        rawEmail: email.raw,
        extracted: email.extracted,
        consensusStrength: 0.5,
        disagreementFlags: ["not_analyzed_budget_capped"],
      });
      const explanation = buildExplanation({
        primaryCategory: email.primaryCategory,
        priorityScore: email.priorityScore,
        trustedDecision,
        signalGroups,
        uncertainty,
      });
      const routedDecision = routeInboxDecision({
        confidencePct: trustedDecision.confidencePct,
        uncertaintyPercent,
        riskScore: trustedDecision.riskScore,
        disagreementFlags: ["not_analyzed_budget_capped"],
        config: effectiveDecisionPolicyConfig,
      });
      const decision = applyRoutingOverride({
        decision: routedDecision,
        override: email.temporalContext.routingOverride,
        reason: email.temporalContext.unresolvedThread.routingOverride
          ? `Temporal context override: ${email.temporalContext.unresolvedThread.rationale}`
          : email.temporalContext.routingOverride
            ? `Temporal context override: ${email.temporalContext.convergingSignal.rationale}`
            : routedDecision.reason,
      });
      const temporalRoutingNote = email.temporalContext.routingOverride
        ? ` Routing elevated by temporal context: ${email.temporalContext.temporalFlags
            .filter((flag) => flag.startsWith("temporal:routing"))
            .join(", ")}.`
        : "";
      const decisionTrace = {
        ...buildDecisionTrace({
          primaryCategory: email.primaryCategory,
          priorityScore: email.priorityScore,
          trustedAction: trustedDecision.action,
          riskTags: decisionRiskTags,
          topCategoryScores: email.categoryScores.slice(0, 4).map((entry) => ({
            category: entry.category,
            score: entry.score,
          })),
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          threadDepth: email.thread.depth,
          threadRiskDensity: email.thread.riskDensity,
          consensusScore: 50,
          policyVersion: INBOX_POLICY_VERSION,
          modelVersion,
        }),
        explanation: `${explanation.summary}${temporalRoutingNote}`,
      };
      const memoryRef = buildMemoryRef({
        raw: email.raw,
        subject: email.subject,
        senderEmail: email.senderEmail,
      });

      alerts.push({
        id: email.id,
        from: email.from,
        senderEmail: email.senderEmail || "",
        senderDomain: email.senderDomain || "",
        subject: email.subject,
        priorityScore: email.priorityScore,
        priority: email.priority,
        primaryCategory: email.primaryCategory,
        mailClass: classReconcile.mailClass,
        threatType: classReconcile.threatType,
        decisionTrace,
        categoryScores: email.categoryScores,
        riskTags: decisionRiskTags,
        signals: decisionSignals,
        signalGroups,
        uncertainty,
        explanation,
        decision,
        suggestedAction: "No action suggested (not analyzed).",
        draftReply: "No reply needed.",
        consensusScore: 50,
        consensusNote: "Not passed through multi-model draft analysis due to TOP_N budget.",
        agreement_scores: defaultAgreementScores(),
        disagreement_flags: ["not_analyzed_budget_capped"],
        consensus_strength: 0.5,
        trustedDecision,
        classifier: email.classifier,
        guardrails: {
          policyVersion: INBOX_POLICY_VERSION,
          ruleHits: policyRuleHits,
          rationale: [
            email.priorityGuardrail.rationale,
            ...email.falsePositiveGuard.corrections.map((correction) => correction.reason),
            actionGuardrail.note,
            classReconcile.rationale,
          ]
            .filter(Boolean)
            .join(" "),
          priorityAdjusted:
            email.priorityGuardrail.adjusted || email.falsePositiveGuard.guardActivated,
          actionAdjusted: actionGuardrail.adjusted,
          classificationAdjusted: classReconcile.adjusted,
        },
        memoryRef,
        trustScore: email.trustScore,
        reputationScore: email.reputation.score,
        reputationFindings: email.reputation.findings,
        thread: email.thread,
        uncertaintyPercent,
        baseUncertaintyPercent: guardedBaseUncertaintyPercent,
        rawEmail: email.raw,
        extracted: {
          deadlines: email.extracted.deadlines,
          moneyMentions: email.extracted.moneyMentions,
          urls: email.extracted.urls,
          attachments: email.extracted.attachments,
          attachmentRiskScore: email.extracted.attachmentRiskScore,
        },
      });
    }

    for (const alert of alerts) {
      updateTrustGraph(trustGraph, alert.senderEmail, alert.senderDomain, alert.priority);
    }
    writeTrustGraphCookie(cookieStore, trustGraph);

    const learningSamplesUsed = alerts.reduce(
      (sum, alert) => sum + (alert.classifier.memorySampleCount > 0 ? 1 : 0),
      0
    );
    const processingMode: "offline_enforced" | "hybrid_remote_llm" = offlineEnforced
      ? "offline_enforced"
      : "hybrid_remote_llm";
    const consensusMode: "single" | "multi" = consensusPolicy.enabled ? "multi" : "single";
    const classifierVersion =
      alerts[0]?.classifier.modelVersion || "inbox-hybrid-classifier-v1";

    await persistInboxMemory({
      alerts,
      modelVersion,
      policyVersion: INBOX_POLICY_VERSION,
    });

    await persistInboxEvaluationLog({
      alerts,
      sourceMode: parsed.mode,
      processingMode,
      modelVersion,
      classifierVersion,
      policyVersion: INBOX_POLICY_VERSION,
      consensusMode,
      consensusSource: consensusPolicy.source,
      consensusMaxModels: consensusPolicy.enabled ? consensusPolicy.maxModels : 1,
      consensusModels: selectedConsensusModels,
    });

    const recentOutcomeHistory = await loadRecentAdaptiveOutcomeHistory(200);
    const adaptiveResult = computeAdaptiveThresholds({
      outcomeHistory: recentOutcomeHistory,
      currentThresholds: effectiveThresholds,
      minSampleSize: 12,
    });
    await saveAdaptiveThresholds(
      process.env.AEGIS_DATA_DIR ?? "./data",
      adaptiveResult
    );

    const meta = {
      mode: parsed.mode,
      processingMode,
      offlineState: offlineConfig.state,
      scanned: scored.length,
      highCount: alerts.filter((a) => a.priority === "high").length,
      mediumCount: alerts.filter((a) => a.priority === "medium").length,
      lowCount: alerts.filter((a) => a.priority === "low").length,
      policyVersion: INBOX_POLICY_VERSION,
      modelVersion,
      classifierVersion,
      guardrailVersion: INBOX_POLICY_VERSION,
      learningSamplesUsed,
      consensusMode,
      consensusMaxModels: consensusPolicy.enabled ? consensusPolicy.maxModels : 1,
      consensusSource: consensusPolicy.source,
      adaptiveDiagnostics: adaptiveResult.diagnostics,
    };

    return Response.json(InboxResponseSchema.parse({ ok: true, alerts, meta }));
  } catch (err: unknown) {
    console.error("Inbox error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Inbox scan failed", detail }, { status: 500 });
      }
    }
  );
}
