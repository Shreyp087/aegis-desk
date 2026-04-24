import path from "path";

import { z } from "zod";

export const InboxTrustSurfaceLayerSchema = z.object({
  id: z.enum([
    "in_request_email_handling",
    "session_store",
    "browser_session_cache",
    "trust_graph_cookie",
    "incident_memory",
    "sender_reputation_snapshot",
    "feedback_artifacts",
    "evaluation_logs",
    "adaptive_threshold_cache",
    "optional_model_outputs",
  ]),
  label: z.string(),
  location: z.string(),
  retention: z.string(),
  containsRawEmailContent: z.boolean(),
  enabled: z.boolean(),
  dataForm: z.array(z.string()).max(8),
  storedFields: z.array(z.string()).max(12),
  purpose: z.string(),
});

export const InboxTrustSurfaceFlagSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning"]),
  title: z.string(),
  detail: z.string(),
  codepaths: z.array(z.string()).max(8),
});

export const InboxTrustSurfaceSchema = z.object({
  version: z.literal(1),
  localFirst: z.boolean(),
  deterministicCriticalPath: z.boolean(),
  processingMode: z.enum(["offline_enforced", "hybrid_remote_llm"]),
  summary: z.object({
    requestScopedRawEmailHandling: z.boolean(),
    browserSessionStoresRawEmail: z.boolean(),
    httpOnlyTrustCookie: z.boolean(),
    serverSideDerivedMemoryOnly: z.boolean(),
    optionalRemoteModelProcessing: z.boolean(),
    evaluationLogStore: z.enum(["mongo", "jsonl"]),
  }),
  layers: z.array(InboxTrustSurfaceLayerSchema).min(1).max(10),
  flags: z.array(InboxTrustSurfaceFlagSchema).max(8),
});

export type InboxTrustSurface = z.infer<typeof InboxTrustSurfaceSchema>;

type BuildInboxTrustSurfaceArgs = {
  processingMode: "offline_enforced" | "hybrid_remote_llm";
  mongoConfigured: boolean;
};

const TRUST_COOKIE_MAX_AGE_DAYS = 120;
const TRUST_COOKIE_ENTRY_CAP = 80;

/**
 * Resolves the local data directory used by inbox evaluation and adaptive-threshold files.
 *
 * Pipeline step: trust-surface metadata builder only.
 * False-positive scenario addressed: keeps the storage map tied to the same local paths the runtime actually uses.
 */
function getLocalDataDir(): string {
  return process.env.AEGIS_DATA_DIR || path.join(process.cwd(), "data");
}

/**
 * Builds a technically grounded storage and privacy map for the inbox scanner.
 *
 * Pipeline step: response metadata builder for the trust panel and developer-facing audit surface.
 * False-positive scenario addressed: keeps privacy claims tied to concrete code paths instead of hand-wavy product language.
 */
export function buildInboxTrustSurface(
  args: BuildInboxTrustSurfaceArgs
): InboxTrustSurface {
  const dataDir = getLocalDataDir();
  const adaptiveThresholdPath = path.join(dataDir, "inbox", "adaptive_thresholds.json");
  const evaluationLogPath = path.join(dataDir, "inbox", "scanner.evaluation.jsonl");
  const evaluationLogStore = args.mongoConfigured ? "mongo" : "jsonl";
  const remoteModelProcessing = args.processingMode === "hybrid_remote_llm";

  return InboxTrustSurfaceSchema.parse({
    version: 1,
    localFirst: true,
    deterministicCriticalPath: true,
    processingMode: args.processingMode,
    summary: {
      requestScopedRawEmailHandling: true,
      browserSessionStoresRawEmail: false,
      httpOnlyTrustCookie: true,
      serverSideDerivedMemoryOnly: true,
      optionalRemoteModelProcessing: remoteModelProcessing,
      evaluationLogStore,
    },
    layers: [
      {
        id: "in_request_email_handling",
        label: "In-request email handling",
        location: "Server request memory",
        retention: "Request lifecycle only",
        containsRawEmailContent: true,
        enabled: true,
        dataForm: [
          "raw email content",
          "parsed headers",
          "parsed body",
          "derived extracted entities",
        ],
        storedFields: [
          "rawEmail",
          "subject",
          "from",
          "senderEmail",
          "senderDomain",
          "threadKey",
          "deadlines",
          "moneyMentions",
          "urls",
          "attachments",
        ],
        purpose:
          "Parse, score, classify, and route the current inbox batch during one scan.",
      },
      {
        id: "session_store",
        label: "Temporal session store",
        location: "Server request memory (Map indexes)",
        retention: "Request lifecycle only",
        containsRawEmailContent: false,
        enabled: true,
        dataForm: ["hashed identifiers", "derived signals", "scores", "labels", "timestamps"],
        storedFields: [
          "senderDomainHash",
          "threadKeyHash",
          "subjectPatternHash",
          "clusterKey",
          "receivedAt",
          "priorityScore",
          "priorityBand",
          "threatScore",
          "urgencyScore",
          "trustedAction",
          "routingAction",
          "fpGuardDelta",
        ],
        purpose:
          "Support batch-as-document temporal reasoning without persisting raw content.",
      },
      {
        id: "browser_session_cache",
        label: "Scanner browser session cache",
        location: "Browser sessionStorage (aegis:inbox-scanner-session:v1)",
        retention: "Until browser session is cleared or replaced",
        containsRawEmailContent: false,
        enabled: true,
        dataForm: ["derived decisions", "explanations", "capsules", "UI state"],
        storedFields: [
          "alerts[]",
          "rawEmailAvailable",
          "decisionCapsule",
          "explanation",
          "suggestedAction",
          "draftReply",
          "memoryRef",
          "meta",
        ],
        purpose:
          "Preserve scanner results in the browser so the user can refresh or switch workspaces without rescanning, while stripping raw email bodies from persisted session state.",
      },
      {
        id: "trust_graph_cookie",
        label: "Trust graph",
        location: "Browser HttpOnly cookie (aegis_inbox_trust_graph)",
        retention: `${TRUST_COOKIE_MAX_AGE_DAYS} days maxAge; pruned to ${TRUST_COOKIE_ENTRY_CAP} sender hashes and ${TRUST_COOKIE_ENTRY_CAP} domain hashes`,
        containsRawEmailContent: false,
        enabled: true,
        dataForm: ["hashed identifiers", "counts", "timestamps"],
        storedFields: [
          "hashed sender key",
          "hashed domain key",
          "seen",
          "high",
          "medium",
          "lastSeen",
        ],
        purpose:
          "Carry lightweight sender/domain familiarity across sessions without storing message bodies.",
      },
      {
        id: "incident_memory",
        label: "Incident memory",
        location: args.mongoConfigured
          ? "MongoDB collection: IncidentMemory"
          : "Disabled when MONGODB_URI is unset",
        retention: args.mongoConfigured
          ? "Persistent until manually purged; no TTL in schema"
          : "Not stored",
        containsRawEmailContent: false,
        enabled: args.mongoConfigured,
        dataForm: ["hashed identifiers", "sender domain", "derived signals", "scores", "labels"],
        storedFields: [
          "sourceHash",
          "senderDomain",
          "senderEmailHash",
          "subjectHash",
          "primaryCategory",
          "mailClass",
          "threatType",
          "trustedAction",
          "priorityScore",
          "signals",
          "uncertainty",
          "explanationSummary",
        ],
        purpose:
          "Provide privacy-limited learning memory and feedback lookup for later scans.",
      },
      {
        id: "sender_reputation_snapshot",
        label: "Sender reputation snapshot",
        location: args.mongoConfigured
          ? "MongoDB collection: SenderReputationSnapshot"
          : "Disabled when MONGODB_URI is unset",
        retention: args.mongoConfigured
          ? "Persistent until manually purged; no TTL in schema"
          : "Not stored",
        containsRawEmailContent: false,
        enabled: args.mongoConfigured,
        dataForm: ["sender-domain identifier", "hashed sender identifier", "scores", "counts"],
        storedFields: [
          "senderDomain",
          "senderEmailHash",
          "trustScore",
          "reputationScore",
          "highCount",
          "mediumCount",
          "lowCount",
          "sampleSize",
          "notes",
          "lastSeenAt",
        ],
        purpose:
          "Track sender/domain reputation snapshots without retaining message bodies.",
      },
      {
        id: "feedback_artifacts",
        label: "Feedback artifacts",
        location: args.mongoConfigured
          ? "MongoDB updates applied to IncidentMemory by sourceHash"
          : "Disabled when MONGODB_URI is unset",
        retention: args.mongoConfigured
          ? "Same retention as IncidentMemory"
          : "Not stored",
        containsRawEmailContent: false,
        enabled: args.mongoConfigured,
        dataForm: ["feedback labels", "corrected class", "corrected priority score"],
        storedFields: [
          "sourceHash",
          "sourceEmailId",
          "outcomeLabel",
          "correctedClass",
          "correctedPriority",
          "feedbackSource",
        ],
        purpose:
          "Apply user corrections to the derived memory record without storing raw message content.",
      },
      {
        id: "evaluation_logs",
        label: "Evaluation logs",
        location: args.mongoConfigured
          ? "MongoDB collection: InboxEvaluationLog"
          : evaluationLogStore === "jsonl"
            ? evaluationLogPath
            : "MongoDB collection: InboxEvaluationLog",
        retention: args.mongoConfigured
          ? "Persistent until manually purged; no TTL in schema"
          : "Persistent local JSONL file until manually removed",
        containsRawEmailContent: false,
        enabled: true,
        dataForm: ["derived labels", "confidence", "uncertainty", "consensus metadata", "versions"],
        storedFields: [
          "messageId",
          "prediction",
          "rawPrediction",
          "confidence",
          "uncertainty",
          "action",
          "routingAction",
          "consensusMode",
          "consensusStrength",
          "processingMode",
          "modelVersion",
          "groundTruth",
        ],
        purpose:
          "Support measurement, offline evaluation, and adaptive threshold tuning using structured outcomes only.",
      },
      {
        id: "adaptive_threshold_cache",
        label: "Adaptive threshold cache",
        location: adaptiveThresholdPath,
        retention: "Persistent local JSON file until manually removed",
        containsRawEmailContent: false,
        enabled: true,
        dataForm: ["threshold values", "diagnostics", "adjustment history"],
        storedFields: [
          "recommended thresholds",
          "adjustments[]",
          "sampleSize",
          "falsePositiveRate",
          "falseNegativeRate",
          "recommendedFocus",
        ],
        purpose:
          "Carry explainable per-user calibration forward between scans without storing messages.",
      },
      {
        id: "optional_model_outputs",
        label: "Optional model outputs and remote assist path",
        location: remoteModelProcessing
          ? "External provider API request plus browser alert payload"
          : "Offline deterministic mode only; remote path disabled",
        retention: remoteModelProcessing
          ? "Provider-controlled for raw request handling; local response fields persist only where other layers already store them"
          : "No remote transfer",
        containsRawEmailContent: remoteModelProcessing,
        enabled: true,
        dataForm: ["raw email transfer when enabled", "generated model output", "consensus metadata"],
        storedFields: [
          "rawEmail (remote prompt when enabled)",
          "suggestedAction",
          "draftReply",
          "consensusScore",
          "consensusNote",
          "consensus_strength",
          "agreement_scores",
          "disagreement_flags",
        ],
        purpose:
          "Provide optional bounded model assistance while keeping the deterministic pipeline as the source of truth.",
      },
    ],
    flags: [
      {
        id: "browser_session_cache_sanitized",
        severity: "info",
        title: "Browser session cache strips raw email content",
        detail:
          "The inbox scanner UI keeps derived decisions in sessionStorage but omits rawEmail so refreshed sessions can restore triage state without persisting the full message body.",
        codepaths: [
          "src/components/InboxScannerPanel.tsx persistInboxScannerSession()",
          "src/lib/inbox/browserSessionCache.ts sanitizeAlertsForBrowserSession()",
        ],
      },
      {
        id: "api_raw_email_exposure",
        severity: "warning",
        title: "Inbox API response includes raw email content",
        detail:
          "The /api/inbox response returns rawEmail to the browser so the scanner UI can render the message body and allow analyst review.",
        codepaths: [
          "src/app/api/inbox/route.ts AlertSchema.rawEmail",
          "src/components/InboxScannerPanel.tsx buildBodyBlocks()",
        ],
      },
      ...(remoteModelProcessing
        ? [
            {
              id: "optional_remote_model_transfer",
              severity: "warning" as const,
              title: "Hybrid model assist sends raw email content to configured providers",
              detail:
                "When processingMode is hybrid_remote_llm, rawEmail is sent to the configured model provider set for optional suggestedAction, draftReply, and consensus output.",
              codepaths: [
                "src/app/api/inbox/route.ts llmAssistWithConsensus()",
                "src/app/api/inbox/route.ts buildConsensusModelPool()",
              ],
            },
          ]
        : []),
      {
        id: "plain_sender_domain_persistence",
        severity: "info",
        title: "Sender domains are stored in plain text in learning collections",
        detail:
          "IncidentMemory and SenderReputationSnapshot keep senderDomain in plain text. This is not message content, but it is a persistent identifier.",
        codepaths: [
          "src/app/api/inbox/route.ts persistInboxMemory()",
          "src/lib/models/IncidentMemory.ts",
          "src/lib/models/SenderReputationSnapshot.ts",
        ],
      },
    ],
  });
}
