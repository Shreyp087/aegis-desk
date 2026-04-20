import { z } from "zod";

import {
  ConsensusAgreementScoresSchema,
  defaultAgreementScores,
} from "./consensus";
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

export const InboxExplanationSchema = z.object({
  keyFactors: z.array(z.string()).min(1).max(5),
  summary: z.string(),
});

export type InboxUncertainty = z.infer<typeof InboxUncertaintySchema>;
export type InboxSignalGroups = z.infer<typeof InboxSignalGroupsSchema>;
export type InboxExplanation = z.infer<typeof InboxExplanationSchema>;

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

function maxProbability(probabilities: ProbabilityMap): number {
  return Math.max(
    probabilities.spam,
    probabilities.harmful,
    probabilities.actionable,
    probabilities.informational
  );
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
  const factors: string[] = [];
  const factorSet = new Set<string>();
  const topCategory = args.signalGroups.deterministic.topCategoryScores[0];
  const topRiskTags = args.signalGroups.deterministic.riskTags.slice(0, 2);
  const classifier = args.signalGroups.learned.classifier;
  const consensus = args.signalGroups.learned.consensus;
  const importance = args.signalGroups.deterministic.decisionImportance;
  const topClassifierProb = Math.round(maxProbability(classifier.probabilities) * 100);

  const pushFactor = (value: string | null) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized || factorSet.has(normalized)) return;
    factorSet.add(normalized);
    factors.push(normalized);
  };

  if (topCategory) {
    pushFactor(
      `${humanizeToken(topCategory.category)} scored ${Math.round(topCategory.score)}/100`
    );
  }
  if (importance.attentionType === "act_now") {
    pushFactor(
      `Urgency ${importance.urgencyScore}/100 with relevance ${importance.relevanceScore}/100`
    );
  } else if (importance.attentionType === "verify_now") {
    pushFactor(
      `Threat ${importance.threatScore}/100 with trust gap ${importance.trustGapScore}/100`
    );
  } else if (importance.attentionType === "review_later") {
    pushFactor(
      `Opportunity ${importance.opportunityScore}/100 with relevance ${importance.relevanceScore}/100`
    );
  } else {
    pushFactor(
      `Noise ${importance.noiseScore}/100 outweighs urgency ${importance.urgencyScore}/100`
    );
  }
  pushFactor(`Aegis action ${args.trustedDecision.action.toUpperCase()} at ${args.trustedDecision.riskScore}/100 risk`);
  if (topRiskTags.length > 0) {
    pushFactor(`Risk tags: ${topRiskTags.join(", ")}`);
  }
  if (
    args.signalGroups.deterministic.trustScore <= 45 ||
    args.signalGroups.deterministic.reputationScore <= 45
  ) {
    pushFactor(
      `Trust ${args.signalGroups.deterministic.trustScore}/100 and reputation ${args.signalGroups.deterministic.reputationScore}/100`
    );
  }
  if (args.signalGroups.deterministic.extractedCounts.attachmentRiskScore >= 30) {
    pushFactor(
      `${args.signalGroups.deterministic.extractedCounts.attachments} attachment(s) with ${args.signalGroups.deterministic.extractedCounts.attachmentRiskScore}/100 attachment risk`
    );
  } else if (args.signalGroups.deterministic.extractedCounts.urls > 0) {
    pushFactor(
      `${args.signalGroups.deterministic.extractedCounts.urls} extracted URL(s)`
    );
  }
  pushFactor(
      `Classifier predicted ${classifier.predictedClass.toUpperCase()} (${topClassifierProb}% probability)`
  );
  if (importance.affinityScore >= 35) {
    pushFactor(`Historical affinity ${importance.affinityScore}/100 from past inbox outcomes`);
  }
  if (
    consensus.disagreementFlags.length > 0 ||
    consensus.strength < 0.58
  ) {
    pushFactor(
      `Consensus strength ${Math.round(consensus.strength * 100)}%${consensus.disagreementFlags.length > 0 ? ` with flags ${consensus.disagreementFlags.slice(0, 2).join(", ")}` : ""}`
    );
  }
  if (args.uncertainty.type.length > 0) {
    pushFactor(
      `Uncertainty ${Math.round(args.uncertainty.score * 100)}% due to ${args.uncertainty.type
        .map(humanizeToken)
        .join(", ")}`
    );
  }
  if (args.signalGroups.deterministic.guardrails.ruleHits.length > 0) {
    pushFactor(
      `Policy hits: ${args.signalGroups.deterministic.guardrails.ruleHits
        .slice(0, 2)
        .join(", ")}`
    );
  }

  while (factors.length < 3) {
    if (factors.length === 0) {
      pushFactor(`Primary category ${humanizeToken(args.primaryCategory)}`);
    } else if (factors.length === 1) {
      pushFactor(`Priority ${args.priorityScore}/100`);
    } else {
      pushFactor(
        `Thread depth ${args.signalGroups.deterministic.thread.depth} with risk density ${args.signalGroups.deterministic.thread.riskDensity}`
      );
    }
  }

  const keyFactors = factors.slice(0, 5);
  let summaryLead = "Review later";
  let summaryRationale = importance.rationale;
  if (importance.attentionType === "act_now") {
    summaryLead = "Act now";
  } else if (importance.attentionType === "verify_now") {
    summaryLead = "Verify before acting";
  } else if (importance.attentionType === "ignore_routine") {
    summaryLead = "Low-attention routine";
  }
  if (args.primaryCategory === "deadline_scheduling" && args.priorityScore >= 80) {
    summaryLead = "Act now";
    summaryRationale = "Time-sensitive message with a deadline or scheduling consequence if ignored.";
  }
  if (
    (args.primaryCategory === "newsletter" || args.primaryCategory === "sales_marketing") &&
    args.priorityScore < 40 &&
    args.trustedDecision.action === "allow"
  ) {
    summaryLead = "Low-attention routine";
    summaryRationale = "Promotional or routine noise signals outweigh any likely action value.";
  }
  const summary = `${summaryLead}: ${summaryRationale} Aegis recommends ${args.trustedDecision.action.toUpperCase()} with ${args.trustedDecision.riskScore}/100 risk. Drivers: ${keyFactors
    .slice(0, 3)
    .join("; ")}.`;

  return {
    keyFactors,
    summary,
  };
}
