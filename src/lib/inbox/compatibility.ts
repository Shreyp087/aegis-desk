import { z } from "zod";

import {
  ConsensusAgreementScoresSchema,
  defaultAgreementScores,
} from "./consensus";
import type { InboxDecision } from "./decision";
import type { InboxDecisionAxes } from "./decisionAxes";
import type { InboxEventInference } from "./eventTaxonomy";
import type { InboxAttentionType } from "./importance";
import { InboxMailClassEnum } from "./schemas";

const ProbabilitySchema = z.object({
  spam: z.number().min(0).max(1),
  harmful: z.number().min(0).max(1),
  actionable: z.number().min(0).max(1),
  informational: z.number().min(0).max(1),
});

export const InboxUncertaintyTypeEnum = z.enum([
  "epistemic",
  "missing_data",
  "conflict",
]);

export const InboxUncertaintySchema = z.object({
  score: z.number().min(0).max(1),
  type: z.array(InboxUncertaintyTypeEnum),
  sources: z.object({
    model_confidence: z.number().min(0).max(1),
    signal_conflict: z.number().min(0).max(1),
    missing_fields: z.number().int().min(0),
  }),
});

export const InboxSignalGroupsSchema = z.object({
  deterministic: z.object({
    topCategoryScores: z.array(
      z.object({
        category: z.string(),
        score: z.number().min(0).max(100),
        reason: z.string(),
      })
    ),
    riskTags: z.array(z.string()),
    signals: z.array(z.string()),
    trustScore: z.number().min(0).max(100),
    reputationScore: z.number().min(0).max(100),
    reputationFindings: z.array(z.string()),
    thread: z.object({
      depth: z.number().int().min(1),
      riskDensity: z.number().min(0).max(1),
    }),
    extractedCounts: z.object({
      deadlines: z.number().int().min(0),
      moneyMentions: z.number().int().min(0),
      urls: z.number().int().min(0),
      attachments: z.number().int().min(0),
      attachmentRiskScore: z.number().min(0).max(100),
    }),
    guardrails: z.object({
      ruleHits: z.array(z.string()),
      rationale: z.string(),
    }),
    decisionImportance: z.object({
      threatScore: z.number().min(0).max(100),
      urgencyScore: z.number().min(0).max(100),
      relevanceScore: z.number().min(0).max(100),
      opportunityScore: z.number().min(0).max(100),
      noiseScore: z.number().min(0).max(100),
      trustGapScore: z.number().min(0).max(100),
      affinityScore: z.number().min(0).max(100),
      attentionType: z.enum([
        "act_now",
        "verify_now",
        "review_later",
        "ignore_routine",
      ]),
      rationale: z.string(),
    }),
  }),
  learned: z.object({
    classifier: z.object({
      modelVersion: z.string(),
      predictedClass: InboxMailClassEnum,
      probabilities: ProbabilitySchema,
      memorySampleCount: z.number().int().min(0),
      rationale: z.string(),
    }),
    consensus: z.object({
      score: z.number().min(0).max(100),
      note: z.string(),
      strength: z.number().min(0).max(1),
      agreementScores: ConsensusAgreementScoresSchema,
      disagreementFlags: z.array(z.string()),
    }),
  }),
});

export const InboxExplanationReasonTypeEnum = z.enum([
  "event_detected",
  "category_signal",
  "sensitive_event",
  "pattern_novelty",
  "security_signal",
  "trust_gap",
  "stale_urgency_decay",
  "promo_suppression",
  "silence_break",
  "unresolved_thread",
  "converging_signals",
  "user_feedback_history",
  "false_positive_guard",
  "uncertainty_trigger",
  "route_change",
]);

export const InboxExplanationReasonDirectionEnum = z.enum([
  "increase_attention",
  "reduce_attention",
  "increase_security",
  "change_route",
  "reduce_confidence",
  "context",
]);

export const InboxExplanationReasonFragmentSchema = z.object({
  type: InboxExplanationReasonTypeEnum,
  direction: InboxExplanationReasonDirectionEnum,
  title: z.string(),
  detail: z.string(),
  evidence: z.array(z.string()).max(4),
  weight: z.number().min(0).max(100),
});

export const InboxExplanationAuditTrailSchema = z.object({
  topSignals: z.array(z.string()).max(4),
  scoreReducers: z.array(z.string()).max(4),
  attentionDrivers: z.array(z.string()).max(4),
  routeDrivers: z.array(z.string()).max(4),
});

export const InboxExplanationSchema = z.object({
  keyFactors: z.array(z.string()).min(1).max(5),
  summary: z.string(),
  reasonFragments: z.array(InboxExplanationReasonFragmentSchema).min(1).max(12),
  auditTrail: InboxExplanationAuditTrailSchema,
});

export type InboxUncertainty = z.infer<typeof InboxUncertaintySchema>;
export type InboxSignalGroups = z.infer<typeof InboxSignalGroupsSchema>;
export type InboxExplanation = z.infer<typeof InboxExplanationSchema>;
export type InboxExplanationReasonFragment = z.infer<
  typeof InboxExplanationReasonFragmentSchema
>;
export type InboxExplanationAuditTrail = z.infer<
  typeof InboxExplanationAuditTrailSchema
>;

type ProbabilityMap = z.infer<typeof ProbabilitySchema>;

type ClassifierSnapshot = {
  modelVersion: string;
  predictedClass: z.infer<typeof InboxMailClassEnum>;
  probabilities: ProbabilityMap;
  memorySampleCount: number;
  rationale: string;
};

type ConsensusSnapshot = {
  score: number;
  note: string;
  strength?: number | null;
  agreementScores?: z.infer<typeof ConsensusAgreementScoresSchema> | null;
  disagreementFlags?: string[] | null;
};

type CategoryScoreLike = {
  category: string;
  score: number;
  reason: string;
};

type DeterministicSignalArgs = {
  categoryScores: CategoryScoreLike[];
  riskTags: string[];
  signals: string[];
  trustScore: number;
  reputationScore: number;
  reputationFindings: string[];
  thread: {
    depth: number;
    riskDensity: number;
  };
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
    attachmentRiskScore: number;
  };
  guardrails: {
    ruleHits: string[];
    rationale: string;
  };
  decisionImportance: {
    threatScore: number;
    urgencyScore: number;
    relevanceScore: number;
    opportunityScore: number;
    noiseScore: number;
    trustGapScore: number;
    affinityScore: number;
    attentionType: InboxAttentionType;
    rationale: string;
  };
  classifier: ClassifierSnapshot;
  consensus: ConsensusSnapshot;
};

type StructuredUncertaintyArgs = {
  uncertaintyPercent: number;
  categoryScores: CategoryScoreLike[];
  classifier: ClassifierSnapshot;
  finalMailClass: z.infer<typeof InboxMailClassEnum>;
  senderEmail?: string | null;
  senderDomain?: string | null;
  rawEmail: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
  };
  consensusStrength?: number | null;
  disagreementFlags?: string[] | null;
};

type ExplanationArgs = {
  primaryCategory: string;
  priorityScore: number;
  trustedDecision: {
    action: string;
    riskScore: number;
  };
  signalGroups: InboxSignalGroups;
  uncertainty: InboxUncertainty;
  decisionAxes?: InboxDecisionAxes;
  decision?: InboxDecision;
  eventContext?: Pick<
    InboxEventInference,
    "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
  >;
  falsePositiveGuard?: {
    guardActivated: boolean;
    corrections: Array<{
      rule: string;
      delta: number;
      reason: string;
    }>;
  };
  temporalContext?: {
    temporalFlags: string[];
    totalUrgencyDelta: number;
    totalThreatDelta: number;
    routingOverride: "escalate" | "human_review" | null;
    silenceBreak?: {
      detected: boolean;
      rationale: string;
    };
    unresolvedThread?: {
      detected: boolean;
      rationale: string;
    };
    convergingSignal?: {
      detected: boolean;
      rationale: string;
    };
  };
  urgencyPrediction?: {
    temporalContext: "operational_window" | "close_window" | "async_context" | "standard";
    predictionConfidence: number;
    predictionFactors: Array<{
      factor: string;
      direction: "boost" | "suppress";
      magnitude: number;
      rationale: string;
    }>;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function humanizeToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toSentenceCase(value: string): string {
  const humanized = value.replace(/_/g, " ");
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

function maxProbability(probabilities: ProbabilityMap): number {
  return Math.max(
    probabilities.spam,
    probabilities.harmful,
    probabilities.actionable,
    probabilities.informational
  );
}

function hasAnyRule(rules: string[], prefix: string): boolean {
  return rules.some((rule) => rule === prefix || rule.startsWith(prefix));
}

function uniqueList(values: string[], limit: number): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, limit);
}

function buildRouteLead(args: ExplanationArgs): string {
  if (args.decision?.final_action === "human_review") {
    return "Held for human review";
  }

  switch (args.decisionAxes?.actionRoute.route) {
    case "suppress":
      return "Suppressed";
    case "quarantine":
      return "Quarantined";
    case "block":
      return "Blocked";
    case "escalate":
      return "Escalated";
    case "surface":
      return "Surfaced";
    default:
      return "Explained";
  }
}

function buildRelationshipSummary(args: ExplanationArgs): string {
  if (!args.decisionAxes) {
    return args.signalGroups.deterministic.decisionImportance.rationale;
  }

  const attention = args.decisionAxes.attentionPriority.level;
  const security = args.decisionAxes.securitySeverity.level;
  const route = args.decisionAxes.actionRoute.route;

  if (args.decision?.final_action === "human_review") {
    return "Aegis kept a human in the loop because uncertainty or disagreement made automatic handling unsafe.";
  }

  if (
    (route === "quarantine" || route === "block") &&
    (attention === "none" || attention === "low")
  ) {
    return "Dangerous, but user attention was not requested because Aegis already contained it.";
  }

  if (route === "suppress") {
    return security === "benign" || security === "noisy"
      ? "Noisy or repetitive mail was suppressed so it would not waste attention."
      : "Attention was suppressed because stronger noise controls outweighed direct action value.";
  }

  if (
    (security === "benign" || security === "noisy") &&
    (attention === "high" || attention === "urgent")
  ) {
    return "Safe but important, so Aegis surfaced it for the user.";
  }

  if (
    (security === "suspicious" ||
      security === "harmful" ||
      security === "critical") &&
    (attention === "high" || attention === "urgent")
  ) {
    return "User attention and security review both mattered for this message.";
  }

  if (attention === "none" || attention === "low") {
    return "User attention was not requested because stronger noise or containment signals outweighed action value.";
  }

  return args.signalGroups.deterministic.decisionImportance.rationale;
}

function createReasonFragment(
  fragment: InboxExplanationReasonFragment
): InboxExplanationReasonFragment {
  return {
    ...fragment,
    evidence: uniqueList(fragment.evidence, 4),
    weight: clamp(Math.round(fragment.weight), 0, 100),
  };
}

function buildSignalConflict(args: {
  categoryScores: CategoryScoreLike[];
  classifier: ClassifierSnapshot;
  finalMailClass: z.infer<typeof InboxMailClassEnum>;
  disagreementFlags: string[];
}): number {
  const ordered = [...args.categoryScores].sort((a, b) => b.score - a.score);
  const top = ordered[0]?.score ?? 0;
  const second = ordered[1]?.score ?? 0;
  const spread = top - second;

  let conflict = 0;
  if (spread <= 6) conflict += 0.45;
  else if (spread <= 12) conflict += 0.3;
  else if (spread <= 18) conflict += 0.16;

  if (args.classifier.predictedClass !== args.finalMailClass) {
    conflict += 0.35;
  }

  if (args.disagreementFlags.includes("label_disagreement")) conflict += 0.35;
  if (args.disagreementFlags.includes("action_disagreement")) conflict += 0.35;
  if (args.disagreementFlags.includes("confidence_variance_high")) conflict += 0.15;
  if (args.disagreementFlags.includes("entity_overlap_low")) conflict += 0.1;
  if (args.disagreementFlags.includes("partial_model_failure")) conflict += 0.08;

  return round(clamp(conflict, 0, 1));
}

function buildMissingFieldCount(args: {
  senderEmail?: string | null;
  senderDomain?: string | null;
  rawEmail: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
  };
}): number {
  let missing = 0;
  if (!args.senderEmail) missing += 1;
  if (!args.senderDomain) missing += 1;
  if (args.extracted.urls.length === 0) missing += 1;
  if (args.extracted.attachments.length === 0) missing += 1;
  if (args.extracted.deadlines.length === 0) missing += 1;
  if (args.extracted.moneyMentions.length === 0) missing += 1;
  if (args.rawEmail.trim().length < 170) missing += 1;
  return missing;
}

export function buildSignalGroups(args: DeterministicSignalArgs): InboxSignalGroups {
  return {
    deterministic: {
      topCategoryScores: args.categoryScores.slice(0, 4).map((entry) => ({
        category: entry.category,
        score: entry.score,
        reason: entry.reason,
      })),
      riskTags: args.riskTags,
      signals: args.signals,
      trustScore: args.trustScore,
      reputationScore: args.reputationScore,
      reputationFindings: args.reputationFindings,
      thread: {
        depth: args.thread.depth,
        riskDensity: args.thread.riskDensity,
      },
      extractedCounts: {
        deadlines: args.extracted.deadlines.length,
        moneyMentions: args.extracted.moneyMentions.length,
        urls: args.extracted.urls.length,
        attachments: args.extracted.attachments.length,
        attachmentRiskScore: args.extracted.attachmentRiskScore,
      },
      guardrails: {
        ruleHits: args.guardrails.ruleHits,
        rationale: args.guardrails.rationale,
      },
      decisionImportance: args.decisionImportance,
    },
    learned: {
      classifier: args.classifier,
      consensus: {
        score: args.consensus.score,
        note: args.consensus.note,
        strength: clamp(args.consensus.strength ?? maxProbability(args.classifier.probabilities), 0, 1),
        agreementScores: args.consensus.agreementScores ?? defaultAgreementScores(),
        disagreementFlags: args.consensus.disagreementFlags ?? [],
      },
    },
  };
}

export function buildStructuredUncertainty(
  args: StructuredUncertaintyArgs
): InboxUncertainty {
  const disagreementFlags = args.disagreementFlags ?? [];
  const modelConfidence = round(
    clamp(
      args.consensusStrength ?? maxProbability(args.classifier.probabilities),
      0,
      1
    )
  );
  const signalConflict = buildSignalConflict({
    categoryScores: args.categoryScores,
    classifier: args.classifier,
    finalMailClass: args.finalMailClass,
    disagreementFlags,
  });
  const missingFields = buildMissingFieldCount({
    senderEmail: args.senderEmail,
    senderDomain: args.senderDomain,
    rawEmail: args.rawEmail,
    extracted: args.extracted,
  });
  const score = round(clamp(args.uncertaintyPercent / 100, 0, 1));

  const types: InboxUncertainty["type"] = [];
  if (modelConfidence < 0.6 || score >= 0.55) {
    types.push("epistemic");
  }
  if (
    signalConflict >= 0.35 ||
    disagreementFlags.includes("force_escalation_review")
  ) {
    types.push("conflict");
  }
  if (missingFields >= 3) {
    types.push("missing_data");
  }

  return {
    score,
    type: Array.from(new Set(types)),
    sources: {
      model_confidence: modelConfidence,
      signal_conflict: signalConflict,
      missing_fields: missingFields,
    },
  };
}

export function buildExplanation(args: ExplanationArgs): InboxExplanation {
  const fragments: InboxExplanationReasonFragment[] = [];
  const fragmentKeys = new Set<string>();
  const topCategory = args.signalGroups.deterministic.topCategoryScores[0];
  const topRiskTags = args.signalGroups.deterministic.riskTags.slice(0, 3);
  const classifier = args.signalGroups.learned.classifier;
  const consensus = args.signalGroups.learned.consensus;
  const importance = args.signalGroups.deterministic.decisionImportance;
  const guardrailRules = args.signalGroups.deterministic.guardrails.ruleHits;
  const falsePositiveCorrections = args.falsePositiveGuard?.corrections ?? [];
  const falsePositiveRules = falsePositiveCorrections.map((correction) => correction.rule);
  const allRules = Array.from(new Set([...guardrailRules, ...falsePositiveRules]));

  const auditTrail: InboxExplanationAuditTrail = {
    topSignals: [],
    scoreReducers: [],
    attentionDrivers: [],
    routeDrivers: [],
  };

  const pushAudit = (
    bucket: keyof InboxExplanationAuditTrail,
    value: string | null
  ) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    if (auditTrail[bucket].includes(normalized)) return;
    auditTrail[bucket].push(normalized);
  };

  const pushFragment = (
    fragment: InboxExplanationReasonFragment,
    buckets: Array<keyof InboxExplanationAuditTrail> = []
  ) => {
    const normalized = createReasonFragment(fragment);
    const key = `${normalized.type}:${normalized.title}`;
    if (fragmentKeys.has(key)) return;
    fragmentKeys.add(key);
    fragments.push(normalized);
    for (const bucket of buckets) {
      pushAudit(bucket, normalized.title);
    }
  };

  if (topCategory) {
    pushFragment(
      {
        type: "category_signal",
        direction: "context",
        title: `Category signal: ${humanizeToken(topCategory.category)}`,
        detail: `Top deterministic category score was ${Math.round(topCategory.score)}/100 for ${humanizeToken(
          topCategory.category
        )}.`,
        evidence: [topCategory.reason],
        weight: topCategory.score,
      },
      ["topSignals"]
    );
  }

  if (args.eventContext) {
    pushFragment(
      {
        type: "event_detected",
        direction:
          args.decisionAxes?.attentionPriority.level === "high" ||
          args.decisionAxes?.attentionPriority.level === "urgent"
            ? "increase_attention"
            : "context",
        title: `Event detected: ${humanizeToken(args.eventContext.primaryEventType)}`,
        detail: `Aegis classified the message as ${toSentenceCase(
          args.eventContext.primaryEventType
        )} with ${args.eventContext.confidence}% confidence.`,
        evidence: [
          `confidence ${args.eventContext.confidence}%`,
          args.eventContext.secondaryTags.length > 0
            ? `secondary tags: ${args.eventContext.secondaryTags
                .slice(0, 3)
                .map(humanizeToken)
                .join(", ")}`
            : "",
        ],
        weight: args.eventContext.confidence,
      },
      ["topSignals"]
    );

    if (args.eventContext.sensitiveEvent.detected) {
      pushFragment(
        {
          type: "sensitive_event",
          direction: "increase_attention",
          title: `Sensitive-event boost: ${humanizeToken(
            args.eventContext.sensitiveEvent.family ?? "unknown"
          )}`,
          detail: `A high-confidence must-not-miss pattern raised attention without automatically treating the message as harmful.`,
          evidence: [
            `confidence ${args.eventContext.sensitiveEvent.confidence}%`,
            `must-not-miss ${args.eventContext.sensitiveEvent.mustNotMissScore}/100`,
            `time sensitivity ${humanizeToken(
              args.eventContext.sensitiveEvent.timeSensitivity
            )}`,
            args.eventContext.sensitiveEvent.routeHint
              ? `route hint ${args.eventContext.sensitiveEvent.routeHint}`
              : "",
          ],
          weight: Math.max(
            args.eventContext.sensitiveEvent.mustNotMissScore,
            args.eventContext.sensitiveEvent.confidence
          ),
        },
        ["topSignals", "attentionDrivers"]
      );
    }
  }

  const noveltyFactor = args.urgencyPrediction?.predictionFactors.find(
    (factor) =>
      factor.factor === "P4_subject_trajectory" ||
      factor.factor === "P3_conversation_gap"
  );
  if (noveltyFactor) {
    pushFragment(
      {
        type: "pattern_novelty",
        direction:
          noveltyFactor.direction === "boost"
            ? "increase_attention"
            : "reduce_attention",
        title:
          noveltyFactor.factor === "P3_conversation_gap"
            ? "Conversation timing pattern"
            : "Subject-pattern novelty",
        detail: noveltyFactor.rationale,
        evidence: [
          `prediction confidence ${args.urgencyPrediction?.predictionConfidence ?? 0}/100`,
          `temporal mode ${humanizeToken(
            args.urgencyPrediction?.temporalContext ?? "standard"
          )}`,
          `${noveltyFactor.direction} ${noveltyFactor.magnitude}`,
        ],
        weight: Math.min(
          88,
          36 +
            (args.urgencyPrediction?.predictionConfidence ?? 0) * 0.35 +
            noveltyFactor.magnitude * 3
        ),
      },
      [
        noveltyFactor.direction === "boost"
          ? "attentionDrivers"
          : "scoreReducers",
      ]
    );
  }

  const harmfulProbability = Math.round(classifier.probabilities.harmful * 100);
  const securityLevel = args.decisionAxes?.securitySeverity.level;
  const shouldExplainSecurity =
    securityLevel === "suspicious" ||
    securityLevel === "harmful" ||
    securityLevel === "critical";
  if (
    shouldExplainSecurity ||
    topRiskTags.length > 0 ||
    args.signalGroups.deterministic.extractedCounts.attachmentRiskScore >= 30 ||
    harmfulProbability >= 40 ||
    args.trustedDecision.action === "quarantine" ||
    args.trustedDecision.action === "block"
  ) {
    pushFragment(
      {
        type: "security_signal",
        direction: "increase_security",
        title: shouldExplainSecurity
          ? `Security signal: ${humanizeToken(securityLevel ?? "suspicious")} severity`
          : "Security signal detected",
        detail: args.decisionAxes
          ? args.decisionAxes.securitySeverity.rationale
          : `Security signals increased scrutiny and produced a ${args.trustedDecision.action.toUpperCase()} trusted action.`,
        evidence: [
          topRiskTags.length > 0 ? `risk tags: ${topRiskTags.join(", ")}` : "",
          harmfulProbability > 0 ? `harmful probability ${harmfulProbability}%` : "",
          args.signalGroups.deterministic.extractedCounts.attachmentRiskScore >= 30
            ? `attachment risk ${args.signalGroups.deterministic.extractedCounts.attachmentRiskScore}/100`
            : "",
          args.decisionAxes?.securitySeverity.drivers[0] ?? "",
        ],
        weight: Math.max(
          args.decisionAxes?.securitySeverity.score ?? 0,
          args.trustedDecision.riskScore,
          harmfulProbability,
          args.signalGroups.deterministic.extractedCounts.attachmentRiskScore
        ),
      },
      [
        "topSignals",
        ...(args.decisionAxes?.actionRoute.route === "quarantine" ||
        args.decisionAxes?.actionRoute.route === "block"
          ? (["routeDrivers"] as Array<keyof InboxExplanationAuditTrail>)
          : []),
      ]
    );
  }

  if (
    args.signalGroups.deterministic.trustScore <= 45 ||
    args.signalGroups.deterministic.reputationScore <= 45 ||
    importance.trustGapScore >= 40
  ) {
    pushFragment(
      {
        type: "trust_gap",
        direction: shouldExplainSecurity ? "increase_security" : "context",
        title: "Trust gap",
        detail: "Low sender trust, weak reputation, or a large trust gap increased scrutiny.",
        evidence: [
          `trust ${args.signalGroups.deterministic.trustScore}/100`,
          `reputation ${args.signalGroups.deterministic.reputationScore}/100`,
          `trust gap ${importance.trustGapScore}/100`,
        ],
        weight: Math.max(
          importance.trustGapScore,
          100 - args.signalGroups.deterministic.trustScore,
          100 - args.signalGroups.deterministic.reputationScore
        ),
      },
      ["topSignals"]
    );
  }

  const staleUrgencyCorrections = falsePositiveCorrections.filter((correction) =>
    correction.rule.startsWith("stale_urgency_decay")
  );
  if (
    staleUrgencyCorrections.length > 0 ||
    hasAnyRule(allRules, "stale_urgency_decay")
  ) {
    pushFragment(
      {
        type: "stale_urgency_decay",
        direction: "reduce_attention",
        title: "Stale urgency decay",
        detail:
          staleUrgencyCorrections[0]?.reason ||
          "Expired deadline language reduced urgency instead of keeping the message elevated.",
        evidence: [
          staleUrgencyCorrections.map((correction) => correction.rule).join(", "),
          ...staleUrgencyCorrections
            .slice(0, 2)
            .map((correction) => `${correction.delta} score: ${correction.reason}`),
        ],
        weight: Math.min(
          90,
          45 +
            staleUrgencyCorrections.reduce(
              (total, correction) => total + Math.abs(correction.delta),
              0
            ) *
              2
        ),
      },
      ["scoreReducers"]
    );
  }

  const promoRules = allRules.filter(
    (rule) =>
      rule === "learning_promo_fatigue" ||
      rule === "trusted_bulk_bleed_correction" ||
      rule === "thread_fatigue_promo_boost"
  );
  if (
    promoRules.length > 0 ||
    (args.decisionAxes?.actionRoute.route === "suppress" &&
      (args.primaryCategory === "newsletter" ||
        args.primaryCategory === "sales_marketing"))
  ) {
    pushFragment(
      {
        type: "promo_suppression",
        direction: "reduce_attention",
        title: "Promotional suppression",
        detail: promoRules.includes("learning_promo_fatigue")
          ? "Repeated low-value promo history pushed Aegis to suppress attention without treating the message as harmful."
          : promoRules.includes("trusted_bulk_bleed_correction")
            ? "Trusted-sender familiarity was discounted because the message still looked like bulk promotional noise."
            : "Promotional noise signals outweighed action value.",
        evidence: [
          promoRules.length > 0 ? `rules: ${promoRules.join(", ")}` : "",
          `noise ${importance.noiseScore}/100`,
          `urgency ${importance.urgencyScore}/100`,
        ],
        weight: Math.max(importance.noiseScore, 55),
      },
      ["scoreReducers", "routeDrivers"]
    );
  }

  const silenceFlags =
    args.temporalContext?.temporalFlags.filter((flag) =>
      flag === "temporal:silence_break" || flag === "temporal:silence_cross_session"
    ) ?? [];
  if (
    silenceFlags.length > 0 ||
    args.temporalContext?.silenceBreak?.detected
  ) {
    pushFragment(
      {
        type: "silence_break",
        direction: "increase_attention",
        title: silenceFlags.includes("temporal:silence_cross_session")
          ? "Cross-session silence break"
          : "Silence break",
        detail:
          args.temporalContext?.silenceBreak?.rationale ||
          "A sender broke their normal contact pattern, which raised attention.",
        evidence: [
          `temporal flags: ${silenceFlags.join(", ")}`,
          `urgency delta ${args.temporalContext?.totalUrgencyDelta ?? 0}`,
        ],
        weight: Math.min(85, 48 + (args.temporalContext?.totalUrgencyDelta ?? 0) * 2),
      },
      ["attentionDrivers"]
    );
  }

  const unresolvedFlags =
    args.temporalContext?.temporalFlags.filter((flag) => flag === "temporal:unresolved_thread") ??
    [];
  if (
    unresolvedFlags.length > 0 ||
    args.temporalContext?.unresolvedThread?.detected
  ) {
    pushFragment(
      {
        type: "unresolved_thread",
        direction:
          args.temporalContext?.routingOverride ? "change_route" : "increase_attention",
        title: "Unresolved thread follow-up",
        detail:
          args.temporalContext?.unresolvedThread?.rationale ||
          "A follow-up arrived on a thread that already looked unresolved or actionable.",
        evidence: [
          `temporal flags: ${unresolvedFlags.join(", ")}`,
          `urgency delta ${args.temporalContext?.totalUrgencyDelta ?? 0}`,
          args.temporalContext?.routingOverride
            ? `routing override ${args.temporalContext.routingOverride}`
            : "",
        ],
        weight: Math.min(90, 55 + (args.temporalContext?.totalUrgencyDelta ?? 0) * 2),
      },
      ["topSignals", "attentionDrivers", "routeDrivers"]
    );
  }

  const convergingFlags =
    args.temporalContext?.temporalFlags.filter((flag) =>
      flag.startsWith("temporal:converging:") || flag.startsWith("temporal:campaign:")
    ) ?? [];
  if (
    convergingFlags.length > 0 ||
    args.temporalContext?.convergingSignal?.detected
  ) {
    pushFragment(
      {
        type: "converging_signals",
        direction:
          (args.temporalContext?.totalThreatDelta ?? 0) > 0
            ? "increase_security"
            : "increase_attention",
        title: "Converging cross-email signals",
        detail:
          args.temporalContext?.convergingSignal?.rationale ||
          "Multiple messages in the session pointed at the same cluster of signals.",
        evidence: [
          convergingFlags.length > 0 ? `temporal flags: ${convergingFlags.slice(0, 2).join(", ")}` : "",
          `urgency delta ${args.temporalContext?.totalUrgencyDelta ?? 0}`,
          `threat delta ${args.temporalContext?.totalThreatDelta ?? 0}`,
        ],
        weight: Math.min(
          92,
          52 +
            (args.temporalContext?.totalUrgencyDelta ?? 0) +
            (args.temporalContext?.totalThreatDelta ?? 0) * 2
        ),
      },
      ["topSignals", "attentionDrivers"]
    );
  }

  const feedbackRules = allRules.filter(
    (rule) =>
      rule.startsWith("learning_") || rule.startsWith("feedback_memory_")
  );
  if (
    feedbackRules.length > 0 ||
    (classifier.memorySampleCount > 0 && importance.affinityScore >= 35)
  ) {
    const supportiveHistory =
      feedbackRules.includes("learning_transactional_protection") ||
      feedbackRules.includes("learning_harmful_reinforcement");
    pushFragment(
      {
        type: "user_feedback_history",
        direction: supportiveHistory ? "increase_attention" : "reduce_attention",
        title: "User feedback history",
        detail: feedbackRules.includes("learning_transactional_protection")
          ? "Historical feedback protected this message from being buried by sender or promo history."
          : feedbackRules.includes("learning_harmful_reinforcement")
            ? "Historical feedback reinforced that similar messages have been dangerous before."
            : feedbackRules.includes("learning_promo_fatigue")
              ? "Historical outcomes showed repeated low-value patterns for this sender or category."
              : "Historical inbox outcomes influenced the current decision.",
        evidence: [
          feedbackRules.length > 0 ? `rules: ${feedbackRules.slice(0, 3).join(", ")}` : "",
          classifier.memorySampleCount > 0 ? `memory samples ${classifier.memorySampleCount}` : "",
          `affinity ${importance.affinityScore}/100`,
        ],
        weight: Math.min(
          88,
          40 +
            importance.affinityScore +
            Math.min(classifier.memorySampleCount, 10) * 2
        ),
      },
      [supportiveHistory ? "attentionDrivers" : "scoreReducers"]
    );
  }

  if (args.falsePositiveGuard?.guardActivated && falsePositiveCorrections.length > 0) {
    pushFragment(
      {
        type: "false_positive_guard",
        direction: "reduce_attention",
        title: "False-positive guard correction",
        detail: `Aegis applied ${falsePositiveCorrections.length} correction(s) to avoid over-escalating the message.`,
        evidence: [
          `rules: ${falsePositiveCorrections
            .slice(0, 3)
            .map((correction) => correction.rule)
            .join(", ")}`,
          ...falsePositiveCorrections
            .slice(0, 2)
            .map((correction) => correction.reason),
        ],
        weight: Math.min(
          90,
          38 +
            falsePositiveCorrections.reduce(
              (total, correction) => total + Math.abs(correction.delta),
              0
            ) *
              2
        ),
      },
      ["scoreReducers"]
    );
  }

  const lowConsensus =
    consensus.disagreementFlags.length > 0 || consensus.strength < 0.58;
  if (
    args.uncertainty.type.length > 0 ||
    lowConsensus ||
    args.decision?.final_action === "human_review"
  ) {
    pushFragment(
      {
        type: "uncertainty_trigger",
        direction:
          args.decision?.final_action === "human_review"
            ? "change_route"
            : "reduce_confidence",
        title: "Uncertainty trigger",
        detail:
          args.decision?.final_action === "human_review"
            ? "Uncertainty or disagreement forced a human review workflow."
            : "Aegis lowered confidence because the evidence was incomplete or conflicting.",
        evidence: [
          `uncertainty ${Math.round(args.uncertainty.score * 100)}%`,
          args.uncertainty.type.length > 0
            ? `types: ${args.uncertainty.type.map(humanizeToken).join(", ")}`
            : "",
          `consensus strength ${Math.round(consensus.strength * 100)}%`,
          consensus.disagreementFlags.length > 0
            ? `flags: ${consensus.disagreementFlags.slice(0, 2).join(", ")}`
            : "",
        ],
        weight: Math.max(
          Math.round(args.uncertainty.score * 100),
          100 - Math.round(consensus.strength * 100)
        ),
      },
      [
        ...(args.decision?.final_action === "human_review"
          ? (["routeDrivers"] as Array<keyof InboxExplanationAuditTrail>)
          : []),
        "topSignals",
      ]
    );
  }

  if (
    args.decisionAxes ||
    args.decision?.final_action ||
    args.temporalContext?.routingOverride
  ) {
    const routeTitle =
      args.decision?.final_action === "human_review"
        ? "Workflow route: human review"
        : args.decisionAxes
          ? `Route: ${humanizeToken(args.decisionAxes.actionRoute.route)}`
          : "Workflow route decided";

    pushFragment(
      {
        type: "route_change",
        direction: "change_route",
        title: routeTitle,
        detail:
          args.temporalContext?.routingOverride
            ? `Temporal context changed the workflow route to ${args.temporalContext.routingOverride}.`
            : args.decision?.reason ||
              args.decisionAxes?.actionRoute.rationale ||
              `Aegis chose ${args.trustedDecision.action.toUpperCase()} as the safest next action.`,
        evidence: [
          args.decisionAxes
            ? `action route ${args.decisionAxes.actionRoute.route}`
            : "",
          args.decision ? `workflow ${args.decision.final_action}` : "",
          args.temporalContext?.routingOverride
            ? `temporal override ${args.temporalContext.routingOverride}`
            : "",
          args.decisionAxes?.actionRoute.source
            ? `source ${args.decisionAxes.actionRoute.source}`
            : "",
        ],
        weight: Math.max(
          args.trustedDecision.riskScore,
          args.decision?.final_action === "human_review" ? 78 : 52
        ),
      },
      ["routeDrivers"]
    );
  }

  if (fragments.length === 0) {
    pushFragment(
      {
        type: "category_signal",
        direction: "context",
        title: `Category signal: ${humanizeToken(args.primaryCategory)}`,
        detail: `Aegis fell back to the primary category ${humanizeToken(
          args.primaryCategory
        )} because no stronger structured rationale was available.`,
        evidence: [`priority ${args.priorityScore}/100`],
        weight: Math.max(20, args.priorityScore),
      },
      ["topSignals"]
    );
  }

  fragments.sort((left, right) => right.weight - left.weight);

  if (auditTrail.attentionDrivers.length === 0 && args.decisionAxes) {
    for (const driver of args.decisionAxes.attentionPriority.drivers.slice(0, 2)) {
      pushAudit("attentionDrivers", toSentenceCase(driver));
    }
  }
  if (auditTrail.routeDrivers.length === 0 && args.decisionAxes) {
    pushAudit("routeDrivers", args.decisionAxes.actionRoute.rationale);
  }
  if (auditTrail.topSignals.length === 0 && args.decisionAxes) {
    for (const driver of args.decisionAxes.securitySeverity.drivers.slice(0, 2)) {
      pushAudit("topSignals", toSentenceCase(driver));
    }
  }
  if (auditTrail.scoreReducers.length === 0 && importance.noiseScore >= 65) {
    pushAudit("scoreReducers", `Noise ${importance.noiseScore}/100 outweighed urgency ${importance.urgencyScore}/100`);
  }

  const keyFactors = uniqueList(
    [
      ...auditTrail.topSignals,
      ...auditTrail.attentionDrivers,
      ...auditTrail.routeDrivers,
      ...auditTrail.scoreReducers,
      ...fragments.slice(0, 5).map((fragment) => fragment.title),
      `Priority ${args.priorityScore}/100`,
    ],
    5
  );

  const summaryParts = [
    `${buildRouteLead(args)}: ${buildRelationshipSummary(args)}`,
  ];
  if (args.decisionAxes) {
    summaryParts.push(
      `Attention ${args.decisionAxes.attentionPriority.level.toUpperCase()}, security ${args.decisionAxes.securitySeverity.level.toUpperCase()}, action route ${args.decisionAxes.actionRoute.route.toUpperCase()}.`
    );
  }
  if (auditTrail.topSignals.length > 0) {
    summaryParts.push(`Top signals: ${auditTrail.topSignals.slice(0, 2).join("; ")}.`);
  }
  if (auditTrail.scoreReducers.length > 0) {
    summaryParts.push(`Score reducers: ${auditTrail.scoreReducers.slice(0, 2).join("; ")}.`);
  }
  if (auditTrail.routeDrivers.length > 0) {
    summaryParts.push(`Route drivers: ${auditTrail.routeDrivers.slice(0, 2).join("; ")}.`);
  }

  return {
    keyFactors,
    summary: summaryParts.join(" "),
    reasonFragments: fragments.slice(0, 12),
    auditTrail: {
      topSignals: auditTrail.topSignals.slice(0, 4),
      scoreReducers: auditTrail.scoreReducers.slice(0, 4),
      attentionDrivers: auditTrail.attentionDrivers.slice(0, 4),
      routeDrivers: auditTrail.routeDrivers.slice(0, 4),
    },
  };
}
