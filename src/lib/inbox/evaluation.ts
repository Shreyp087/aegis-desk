import fs from "fs/promises";
import path from "path";

import { z } from "zod";

import { connectMongo, isMongoConfigured } from "@/lib/db/mongoose";
import type { AdaptiveThresholdResult } from "@/lib/inbox/adaptiveThresholds";
import type { FalsePositiveGuardResult } from "@/lib/inbox/falsePositiveGuard";
import type { SessionStore } from "@/lib/inbox/sessionStore.types";
import type { TemporalContextResult } from "@/lib/inbox/temporalContext.types";
import type { UrgencyPredictorResult } from "@/lib/inbox/urgencyPredictor";
import { InboxEvaluationLogModel } from "@/lib/models/InboxEvaluationLog";
import { getAegisDataDir } from "@/lib/tickets/paths";

export const InboxGroundTruthSchema = z.object({
  label: z.string().default(""),
  action: z.string().default(""),
  source: z.string().default(""),
  recorded_at: z.string().default(""),
});

export const InboxEvaluationLogEntrySchema = z.object({
  logged_at: z.string(),
  message_id: z.string(),
  prediction: z.string(),
  raw_prediction: z.string().default(""),
  confidence: z.number().min(0).max(100),
  raw_model_confidence: z.number().min(0).max(1).default(0),
  uncertainty: z.number().min(0).max(1),
  uncertainty_percent: z.number().min(0).max(100).default(0),
  action: z.string(),
  routing_action: z.string().default(""),
  consensus_mode: z.enum(["single", "multi"]).default("single"),
  consensus_source: z.enum(["env_default", "admin_override"]).default("env_default"),
  consensus_max_models: z.number().int().min(1).max(8).default(1),
  consensus_models: z.array(z.string()).default([]),
  consensus_strength: z.number().min(0).max(1).default(0),
  disagreement_flags: z.array(z.string()).default([]),
  source_mode: z.enum(["manual", "gmail"]).default("manual"),
  processing_mode: z.enum(["offline_enforced", "hybrid_remote_llm"]).default("hybrid_remote_llm"),
  model_version: z.string().default(""),
  classifier_version: z.string().default(""),
  policy_version: z.string().default(""),
  ground_truth: InboxGroundTruthSchema.default(InboxGroundTruthSchema.parse({})),
});

export type InboxGroundTruth = z.infer<typeof InboxGroundTruthSchema>;
export type InboxEvaluationLogEntry = z.infer<typeof InboxEvaluationLogEntrySchema>;

type BuildInboxEvaluationLogEntryInput = {
  messageId: string;
  prediction: string;
  rawPrediction?: string;
  confidence: number;
  rawModelConfidence?: number;
  uncertainty: number;
  uncertaintyPercent?: number;
  action: string;
  routingAction?: string;
  consensusMode?: "single" | "multi";
  consensusSource?: "env_default" | "admin_override";
  consensusMaxModels?: number;
  consensusModels?: string[];
  consensusStrength?: number;
  disagreementFlags?: string[];
  sourceMode: "manual" | "gmail";
  processingMode: "offline_enforced" | "hybrid_remote_llm";
  modelVersion: string;
  classifierVersion: string;
  policyVersion: string;
  loggedAt?: string;
  groundTruth?: Partial<InboxGroundTruth>;
};

function getInboxDataDir(): string {
  return path.join(getAegisDataDir(), "inbox");
}

export function getInboxEvaluationLogPath(): string {
  return path.join(getInboxDataDir(), "scanner.evaluation.jsonl");
}

async function ensureInboxDataDir() {
  await fs.mkdir(getInboxDataDir(), { recursive: true });
}

export function buildGroundTruthPlaceholder(
  input?: Partial<InboxGroundTruth>
): InboxGroundTruth {
  return InboxGroundTruthSchema.parse(input ?? {});
}

export function buildInboxEvaluationLogEntry(
  input: BuildInboxEvaluationLogEntryInput
): InboxEvaluationLogEntry {
  return InboxEvaluationLogEntrySchema.parse({
    logged_at: input.loggedAt || new Date().toISOString(),
    message_id: input.messageId,
    prediction: input.prediction,
    raw_prediction: input.rawPrediction || "",
    confidence: input.confidence,
    raw_model_confidence: input.rawModelConfidence ?? 0,
    uncertainty: input.uncertainty,
    uncertainty_percent: input.uncertaintyPercent ?? 0,
    action: input.action,
    routing_action: input.routingAction || "",
    consensus_mode: input.consensusMode || "single",
    consensus_source: input.consensusSource || "env_default",
    consensus_max_models: input.consensusMaxModels ?? 1,
    consensus_models: input.consensusModels ?? [],
    consensus_strength: input.consensusStrength ?? 0,
    disagreement_flags: input.disagreementFlags ?? [],
    source_mode: input.sourceMode,
    processing_mode: input.processingMode,
    model_version: input.modelVersion,
    classifier_version: input.classifierVersion,
    policy_version: input.policyVersion,
    ground_truth: buildGroundTruthPlaceholder(input.groundTruth),
  });
}

export async function appendInboxEvaluationLogEntries(
  entries: InboxEvaluationLogEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  if (isMongoConfigured()) {
    await connectMongo();
    await InboxEvaluationLogModel.insertMany(
      entries.map((entry) => ({
        loggedAt: new Date(entry.logged_at),
        messageId: entry.message_id,
        prediction: entry.prediction,
        rawPrediction: entry.raw_prediction,
        confidence: entry.confidence,
        rawModelConfidence: entry.raw_model_confidence,
        uncertainty: entry.uncertainty,
        uncertaintyPercent: entry.uncertainty_percent,
        action: entry.action,
        routingAction: entry.routing_action,
        consensusMode: entry.consensus_mode,
        consensusSource: entry.consensus_source,
        consensusMaxModels: entry.consensus_max_models,
        consensusModels: entry.consensus_models,
        consensusStrength: entry.consensus_strength,
        disagreementFlags: entry.disagreement_flags,
        sourceMode: entry.source_mode,
        processingMode: entry.processing_mode,
        modelVersion: entry.model_version,
        classifierVersion: entry.classifier_version,
        policyVersion: entry.policy_version,
        groundTruth: {
          label: entry.ground_truth.label,
          action: entry.ground_truth.action,
          source: entry.ground_truth.source,
          recordedAt: entry.ground_truth.recorded_at,
        },
      })),
      { ordered: false }
    );
    return;
  }

  await ensureInboxDataDir();
  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fs.appendFile(getInboxEvaluationLogPath(), payload, "utf8");
}

/**
 * Aggregates how often the false-positive guard fired and how aggressively it reduced scores.
 *
 * Pipeline step: offline evaluation and tuning instrumentation for the post-scoring false-positive correction layer.
 * False-positive scenario addressed: shows which suppression rules are actually reducing noisy inbox surfacing so thresholds can be tuned intentionally.
 */
export function computeFPGuardMetrics(
  results: FalsePositiveGuardResult[]
): {
  guardActivationRate: number;
  ruleBreakdown: Record<string, number>;
  avgScoreReduction: number;
  hardSuppressCount: number;
} {
  if (results.length === 0) {
    return {
      guardActivationRate: 0,
      ruleBreakdown: {},
      avgScoreReduction: 0,
      hardSuppressCount: 0,
    };
  }

  const activated = results.filter((result) => result.guardActivated);
  const ruleBreakdown: Record<string, number> = {};
  let totalReduction = 0;
  let hardSuppressCount = 0;

  for (const result of activated) {
    for (const correction of result.corrections) {
      ruleBreakdown[correction.rule] = (ruleBreakdown[correction.rule] ?? 0) + 1;
      if (correction.delta < 0) {
        totalReduction += Math.abs(correction.delta);
      }
      if (correction.rule === "feedback_memory_hard_suppress") {
        hardSuppressCount += 1;
      }
    }
  }

  return {
    guardActivationRate: Number(
      ((activated.length / results.length) * 100).toFixed(2)
    ),
    ruleBreakdown,
    avgScoreReduction:
      activated.length > 0
        ? Number((totalReduction / activated.length).toFixed(2))
        : 0,
    hardSuppressCount,
  };
}

/**
 * Computes summary metrics for predictive urgency behavior across a batch of scored emails.
 *
 * Pipeline step: evaluation-only instrumentation for the predictive urgency layer.
 * False-positive scenario addressed: helps verify whether predictive boosts and suppressions are firing in the expected contexts instead of inflating noise.
 */
export function computeUrgencyPredictorMetrics(
  predictions: UrgencyPredictorResult[],
  outcomes: string[]
): {
  avgPredictionConfidence: number;
  boostRate: number;
  suppressRate: number;
  avgBoostMagnitude: number;
  avgSuppressMagnitude: number;
  temporalContextBreakdown: Record<string, number>;
  dominantPredictionFactor: string;
} {
  const sampleSize = Math.min(predictions.length, outcomes.length || predictions.length);
  if (sampleSize === 0) {
    return {
      avgPredictionConfidence: 0,
      boostRate: 0,
      suppressRate: 0,
      avgBoostMagnitude: 0,
      avgSuppressMagnitude: 0,
      temporalContextBreakdown: {},
      dominantPredictionFactor: "none",
    };
  }

  const predictionSlice = predictions.slice(0, sampleSize);
  const boosts = predictionSlice.filter((prediction) => prediction.urgencyDelta > 0);
  const suppressions = predictionSlice.filter((prediction) => prediction.urgencyDelta < 0);
  const temporalContextBreakdown: Record<string, number> = {};
  const factorCounts: Record<string, number> = {};

  for (const prediction of predictionSlice) {
    temporalContextBreakdown[prediction.temporalContext] =
      (temporalContextBreakdown[prediction.temporalContext] ?? 0) + 1;
    for (const factor of prediction.predictionFactors) {
      factorCounts[factor.factor] = (factorCounts[factor.factor] ?? 0) + 1;
    }
  }

  let dominantPredictionFactor = "none";
  let dominantFactorCount = 0;
  for (const [factor, count] of Object.entries(factorCounts)) {
    if (count > dominantFactorCount) {
      dominantPredictionFactor = factor;
      dominantFactorCount = count;
    }
  }

  return {
    avgPredictionConfidence: Number(
      (
        predictionSlice.reduce(
          (sum, prediction) => sum + prediction.predictionConfidence,
          0
        ) / sampleSize
      ).toFixed(2)
    ),
    boostRate: Number(((boosts.length / sampleSize) * 100).toFixed(2)),
    suppressRate: Number(((suppressions.length / sampleSize) * 100).toFixed(2)),
    avgBoostMagnitude:
      boosts.length > 0
        ? Number(
            (
              boosts.reduce((sum, prediction) => sum + prediction.urgencyDelta, 0) /
              boosts.length
            ).toFixed(2)
          )
        : 0,
    avgSuppressMagnitude:
      suppressions.length > 0
        ? Number(
            (
              suppressions.reduce(
                (sum, prediction) => sum + Math.abs(prediction.urgencyDelta),
                0
              ) / suppressions.length
            ).toFixed(2)
          )
        : 0,
    temporalContextBreakdown,
    dominantPredictionFactor,
  };
}

/**
 * Measures how much adaptive thresholds are drifting over time and how close they appear to stabilization.
 *
 * Pipeline step: evaluation-only instrumentation for repeated adaptive threshold runs.
 * False-positive scenario addressed: catches unstable self-tuning behavior before threshold drift starts creating new false-positive patterns.
 */
export function computeAdaptiveThresholdMetrics(
  history: AdaptiveThresholdResult[]
): {
  thresholdDriftMap: Record<string, number>;
  mostAdjustedThreshold: string;
  stabilityScore: number;
  cyclesUntilConvergence: number;
} {
  if (history.length === 0) {
    return {
      thresholdDriftMap: {},
      mostAdjustedThreshold: "none",
      stabilityScore: 100,
      cyclesUntilConvergence: 0,
    };
  }

  const keys = Object.keys(history[0].recommended) as Array<
    keyof AdaptiveThresholdResult["recommended"]
  >;
  const thresholdDriftMap: Record<string, number> = {};

  for (const key of keys) {
    const first = history[0].recommended[key];
    const last = history[history.length - 1].recommended[key];
    thresholdDriftMap[key] = Number((last - first).toFixed(2));
  }

  let mostAdjustedThreshold = "none";
  let maxDrift = 0;
  for (const [threshold, drift] of Object.entries(thresholdDriftMap)) {
    if (Math.abs(drift) > maxDrift) {
      mostAdjustedThreshold = threshold;
      maxDrift = Math.abs(drift);
    }
  }

  const transitionMagnitudes: number[] = [];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1].recommended;
    const current = history[index].recommended;
    const avgTransition =
      keys.reduce(
        (sum, key) => sum + Math.abs(current[key] - previous[key]),
        0
      ) / keys.length;
    transitionMagnitudes.push(avgTransition);
  }

  const recentVelocity =
    transitionMagnitudes.length > 0
      ? transitionMagnitudes
          .slice(-3)
          .reduce((sum, value) => sum + value, 0) /
        Math.min(3, transitionMagnitudes.length)
      : 0;
  const stabilityScore = Math.max(
    0,
    Math.min(100, Number((100 - recentVelocity * 18).toFixed(2)))
  );
  const cyclesUntilConvergence =
    recentVelocity <= 0.25 ? 1 : Math.ceil(recentVelocity / 0.25);

  return {
    thresholdDriftMap,
    mostAdjustedThreshold,
    stabilityScore,
    cyclesUntilConvergence,
  };
}

/**
 * Summarizes the structure of one in-memory session store for observability and tuning.
 *
 * Pipeline step: evaluation-only instrumentation for the request-scoped local-first temporal store.
 * False-positive scenario addressed: confirms the store is being populated and updated as expected before temporal detectors consume it.
 */
export function computeSessionStoreMetrics(
  store: SessionStore
): {
  totalRecords: number;
  emailCount: number;
  distinctDomainHashes: number;
  distinctThreadHashes: number;
  distinctClusters: number;
  clusterBreakdown: Record<string, number>;
  avgReceivedAtSpanHours: number;
  recordsWithScores: number;
} {
  const clusterBreakdown: Record<string, number> = {};
  for (const [clusterKey, records] of store.byCluster.entries()) {
    clusterBreakdown[clusterKey] = records.length;
  }

  const receivedTimes = store.allRecords.map((record) => record.receivedAt);
  const minReceivedAt = receivedTimes.length > 0 ? Math.min(...receivedTimes) : 0;
  const maxReceivedAt = receivedTimes.length > 0 ? Math.max(...receivedTimes) : 0;

  return {
    totalRecords: store.allRecords.length,
    emailCount: store.emailCount,
    distinctDomainHashes: store.bySenderDomain.size,
    distinctThreadHashes: store.byThreadKey.size,
    distinctClusters: store.byCluster.size,
    clusterBreakdown,
    avgReceivedAtSpanHours:
      receivedTimes.length > 1
        ? Number((((maxReceivedAt - minReceivedAt) / 3_600_000)).toFixed(2))
        : 0,
    recordsWithScores: store.allRecords.filter((record) => record.priorityScore > 0).length,
  };
}

/**
 * Summarizes how often temporal-context signals fire inside the current scoring batch.
 *
 * Pipeline step: evaluation-only instrumentation for the session-based temporal detectors.
 * False-positive scenario addressed: helps verify whether silence, thread, and convergence boosts are activating at the right rate instead of becoming background inflation.
 */
export function computeTemporalContextMetrics(
  results: TemporalContextResult[]
): {
  silenceBreakRate: number;
  unresolvedThreadRate: number;
  convergingSignalRate: number;
  avgUrgencyDelta: number;
  avgThreatDelta: number;
  routingOverrideRate: number;
  campaignTypeBreakdown: Record<string, number>;
  clusterConvergenceMap: Record<string, number>;
  anyCoordinatedAttack: boolean;
} {
  if (results.length === 0) {
    return {
      silenceBreakRate: 0,
      unresolvedThreadRate: 0,
      convergingSignalRate: 0,
      avgUrgencyDelta: 0,
      avgThreatDelta: 0,
      routingOverrideRate: 0,
      campaignTypeBreakdown: {},
      clusterConvergenceMap: {},
      anyCoordinatedAttack: false,
    };
  }

  const silenceBreakHits = results.filter((result) => result.silenceBreak.detected);
  const unresolvedThreadHits = results.filter((result) => result.unresolvedThread.detected);
  const convergingSignalHits = results.filter((result) => result.convergingSignal.detected);
  const routingOverrideHits = results.filter((result) => Boolean(result.routingOverride));
  const campaignTypeBreakdown: Record<string, number> = {};
  const clusterConvergenceMap: Record<string, number> = {};

  for (const result of convergingSignalHits) {
    campaignTypeBreakdown[result.convergingSignal.campaignType] =
      (campaignTypeBreakdown[result.convergingSignal.campaignType] ?? 0) + 1;
    clusterConvergenceMap[result.convergingSignal.clusterKey] =
      (clusterConvergenceMap[result.convergingSignal.clusterKey] ?? 0) + 1;
  }

  return {
    silenceBreakRate: Number(((silenceBreakHits.length / results.length) * 100).toFixed(2)),
    unresolvedThreadRate: Number(
      ((unresolvedThreadHits.length / results.length) * 100).toFixed(2)
    ),
    convergingSignalRate: Number(
      ((convergingSignalHits.length / results.length) * 100).toFixed(2)
    ),
    avgUrgencyDelta: Number(
      (
        results.reduce((sum, result) => sum + result.totalUrgencyDelta, 0) / results.length
      ).toFixed(2)
    ),
    avgThreatDelta: Number(
      (
        results.reduce((sum, result) => sum + result.totalThreatDelta, 0) / results.length
      ).toFixed(2)
    ),
    routingOverrideRate: Number(
      ((routingOverrideHits.length / results.length) * 100).toFixed(2)
    ),
    campaignTypeBreakdown,
    clusterConvergenceMap,
    anyCoordinatedAttack: convergingSignalHits.some(
      (result) => result.convergingSignal.campaignType === "coordinated_attack"
    ),
  };
}
