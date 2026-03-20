import fs from "fs/promises";
import path from "path";

import { z } from "zod";

import { connectMongo, isMongoConfigured } from "@/lib/db/mongoose";
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
