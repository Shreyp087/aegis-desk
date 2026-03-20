import { z } from "zod";

import { InboxMailClassEnum } from "./schemas";

export const ConsensusActionEnum = z.enum([
  "allow",
  "escalate",
  "quarantine",
  "block",
]);

export const ConsensusModelOutputSchema = z.object({
  suggestedAction: z.string(),
  draftReply: z.string(),
  label: InboxMailClassEnum,
  action: ConsensusActionEnum,
  confidence: z.number().min(0).max(1),
  entities: z.array(z.string()).default([]),
});

export const ConsensusAgreementScoresSchema = z.object({
  label_agreement: z.number().min(0).max(1),
  action_agreement: z.number().min(0).max(1),
  confidence_variance: z.number().min(0).max(1),
  entity_overlap: z.number().min(0).max(1),
});

export type ConsensusModelOutput = z.infer<typeof ConsensusModelOutputSchema>;
export type ConsensusAgreementScores = z.infer<typeof ConsensusAgreementScoresSchema>;

export type ConsensusSuccessfulRun<TSpec = unknown> = {
  spec: TSpec;
  output: ConsensusModelOutput;
};

export type ConsensusEvaluation<TSpec = unknown> = {
  anchor: ConsensusSuccessfulRun<TSpec>;
  agreement_scores: ConsensusAgreementScores;
  disagreement_flags: string[];
  consensus_strength: number;
  consensusScore: number;
  highAgreement: boolean;
};

const HIGH_AGREEMENT_THRESHOLD = 0.58;
const DEFAULT_AGREEMENT_SCORES: ConsensusAgreementScores = {
  label_agreement: 0,
  action_agreement: 0,
  confidence_variance: 0,
  entity_overlap: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function jaccardScore(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function modalAgreement(values: string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Math.max(...counts.values()) / values.length;
}

function populationVariance(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return clamp(variance, 0, 1);
}

function normalizeEntity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function averageEntityOverlap(entityLists: string[][]): number {
  const nonEmpty = entityLists
    .map((entities) => Array.from(new Set(entities.map(normalizeEntity).filter(Boolean))))
    .filter((entities) => entities.length > 0);

  if (nonEmpty.length < 2) return 1;

  let comparisons = 0;
  let total = 0;

  for (let i = 0; i < nonEmpty.length; i += 1) {
    for (let j = i + 1; j < nonEmpty.length; j += 1) {
      const left = new Set(nonEmpty[i]);
      const right = new Set(nonEmpty[j]);
      let intersection = 0;
      for (const entity of left) {
        if (right.has(entity)) intersection += 1;
      }
      const union = left.size + right.size - intersection;
      total += union === 0 ? 1 : intersection / union;
      comparisons += 1;
    }
  }

  return comparisons === 0 ? 1 : clamp(total / comparisons, 0, 1);
}

function pairSimilarity<TSpec>(left: ConsensusSuccessfulRun<TSpec>, right: ConsensusSuccessfulRun<TSpec>): number {
  const actionSimilarity = jaccardScore(
    left.output.suggestedAction,
    right.output.suggestedAction
  );
  const draftSimilarity = jaccardScore(left.output.draftReply, right.output.draftReply);
  return actionSimilarity * 0.6 + draftSimilarity * 0.4;
}

function chooseAnchor<TSpec>(
  successfulRuns: ConsensusSuccessfulRun<TSpec>[]
): ConsensusSuccessfulRun<TSpec> {
  if (successfulRuns.length === 1) return successfulRuns[0];

  let anchor = successfulRuns[0];
  let bestCentrality = -1;

  for (const run of successfulRuns) {
    let similaritySum = 0;
    let comparisons = 0;

    for (const other of successfulRuns) {
      if (run === other) continue;
      similaritySum += pairSimilarity(run, other);
      comparisons += 1;
    }

    const centrality = comparisons === 0 ? 0 : similaritySum / comparisons;
    if (centrality > bestCentrality) {
      bestCentrality = centrality;
      anchor = run;
    }
  }

  return anchor;
}

export function defaultAgreementScores(): ConsensusAgreementScores {
  return { ...DEFAULT_AGREEMENT_SCORES };
}

export function evaluateConsensusRuns<TSpec>(args: {
  successfulRuns: ConsensusSuccessfulRun<TSpec>[];
  totalModelCount: number;
}): ConsensusEvaluation<TSpec> {
  const { successfulRuns, totalModelCount } = args;

  if (successfulRuns.length === 0) {
    throw new Error("evaluateConsensusRuns requires at least one successful run");
  }

  const anchor = chooseAnchor(successfulRuns);

  if (successfulRuns.length === 1) {
    const disagreement_flags =
      totalModelCount > 1 ? ["partial_model_failure"] : [];
    return {
      anchor,
      agreement_scores: {
        label_agreement: 1,
        action_agreement: 1,
        confidence_variance: 0,
        entity_overlap: 1,
      },
      disagreement_flags,
      consensus_strength: 0.52,
      consensusScore: 52,
      highAgreement: false,
    };
  }

  const agreement_scores: ConsensusAgreementScores = {
    label_agreement: modalAgreement(successfulRuns.map((run) => run.output.label)),
    action_agreement: modalAgreement(successfulRuns.map((run) => run.output.action)),
    confidence_variance: populationVariance(
      successfulRuns.map((run) => run.output.confidence)
    ),
    entity_overlap: averageEntityOverlap(
      successfulRuns.map((run) => run.output.entities)
    ),
  };

  const disagreement_flags: string[] = [];
  if (agreement_scores.label_agreement < 0.67) {
    disagreement_flags.push("label_disagreement");
  }
  if (agreement_scores.action_agreement < 0.67) {
    disagreement_flags.push("action_disagreement");
  }
  if (agreement_scores.confidence_variance > 0.04) {
    disagreement_flags.push("confidence_variance_high");
  }

  const comparableEntitySets = successfulRuns.filter(
    (run) => run.output.entities.map(normalizeEntity).filter(Boolean).length > 0
  ).length;
  if (comparableEntitySets >= 2 && agreement_scores.entity_overlap < 0.5) {
    disagreement_flags.push("entity_overlap_low");
  }

  if (successfulRuns.length < totalModelCount) {
    disagreement_flags.push("partial_model_failure");
  }

  const hardDisagreement =
    disagreement_flags.includes("label_disagreement") ||
    disagreement_flags.includes("action_disagreement");
  if (hardDisagreement) {
    disagreement_flags.push("force_escalation_review");
  }

  const consensus_strength = clamp(
    0.35 * agreement_scores.label_agreement +
      0.35 * agreement_scores.action_agreement +
      0.15 * (1 - agreement_scores.confidence_variance) +
      0.15 * agreement_scores.entity_overlap,
    0,
    1
  );

  return {
    anchor,
    agreement_scores,
    disagreement_flags,
    consensus_strength,
    consensusScore: Math.round(consensus_strength * 100),
    highAgreement: consensus_strength >= HIGH_AGREEMENT_THRESHOLD && !hardDisagreement,
  };
}

export function disagreementSeverity(flags: string[]): "none" | "moderate" | "hard" {
  if (
    flags.includes("label_disagreement") ||
    flags.includes("action_disagreement") ||
    flags.includes("force_escalation_review")
  ) {
    return "hard";
  }

  if (
    flags.includes("confidence_variance_high") ||
    flags.includes("entity_overlap_low") ||
    flags.includes("partial_model_failure")
  ) {
    return "moderate";
  }

  return "none";
}
