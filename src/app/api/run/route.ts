import { LinkupClient } from "linkup-sdk";
import { getServerSession } from "@/lib/auth/session";
import {
  addAegisSpanEvent,
  annotateAegisCurrentSpan,
  buildAegisRespanMetadata,
  isRespanEnabled,
  recordAegisSpanException,
  toRespanAssociationProperties,
  withAegisWorkflowSpan,
  withAegisTaskSpan,
  type AegisRespanMetadataInput,
} from "@/lib/observability/respan";

import { privacyFirewall } from "@/lib/tools/privacy";
import { createICS } from "@/lib/tools/ics";

import { createHash } from "crypto";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { connectMongo } from "@/lib/db/mongoose";
import {
  attachClaimVerification,
  ExtractedClaimSchema,
  VerifiedClaimSchema,
} from "@/lib/agent/claimVerification";
import {
  EvidenceConflictSchema,
  EvidenceItemSchema,
  scoreResultsForQuery,
  summarizeResearchEvidence,
  type RawResearchResult,
  type ScoredResearchResult,
} from "@/lib/agent/evidence";
import { formatFinalOutput } from "@/lib/agent/finalFormatter";
import {
  callRespanPrompt,
  RESPAN_PROMPT_ID_SYNTHESIS,
  RESPAN_PROMPTS_ENABLED,
  type PromptVariables,
} from "@/lib/observability/respan/promptClient";

import { extractEntityCandidatesFromContext } from "@/lib/inbox/entityProfiler";
import { EntityProfileCacheModel } from "@/lib/models/EntityProfileCache";
import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";

const linkup = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY! });
const RUN_TRACE_VERSION = 1;
const ENTITY_PROFILE_MODEL = "gpt-4o-mini";
const FINAL_SYNTHESIS_MODEL = "gpt-4o-mini";

const AnalysisSectionTypeEnum = z.enum([
  "contract",
  "security",
  "finance",
  "operations",
  "scheduling",
  "general",
]);

type AnalysisSectionType = z.infer<typeof AnalysisSectionTypeEnum>;

type LinkupDepth = "standard" | "deep";

type RunStep = {
  id: string;
  type: string;
  desc?: string;
  rawQuery?: string;
  title?: string;
  datetimeISO?: string;
  _ics?: string;
  [key: string]: unknown;
};

type RunPlan = {
  goal?: string;
  steps: RunStep[];
  [key: string]: unknown;
};

type NormalizedLinkupResult = ScoredResearchResult;

type SearchResearch = {
  type: "search";
  message: string;
  data: {
    query: string;
    depth: LinkupDepth;
    results: NormalizedLinkupResult[];
  };
};

type RedactionResearch = {
  type: "redaction";
  message: string;
  data: {
    rawQuery: string;
    safeQuery: string;
    removed: string[];
  };
};

type ResearchEvent = SearchResearch | RedactionResearch;

const AnalysisFindingSchema = z.object({
  risk: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  whyItMatters: z.string(),
  suggestedEdit: z.string(),
});

/** ---------- Schema for Outputs (Drafts + Evidence) ---------- */
const GeneratedFinalSchema = z.object({
  summary: z.object({
    email: z.string(),
    document: z.string(),
    deadlines: z.array(z.string()),
    entities: z.array(z.string()),
  }),

  entityVerdicts: z.array(
    z.object({
      entity: z.string(),
      entityType: z.enum(["person", "company", "organization", "unknown"]),
      verdict: z.enum(["genuine", "suspicious", "uncertain"]),
      uncertaintyPct: z.number().min(0).max(100),
      rationale: z.string(),
      proof: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(), // required (can be "")
          reasonThisHelps: z.string(),
        })
      ),
      redFlags: z.array(z.string()),
      followUpChecks: z.array(z.string()),
    })
  ),

  analysisSection: z.object({
    title: z.string(),
    sectionType: AnalysisSectionTypeEnum,
    findings: z.array(AnalysisFindingSchema),
  }),

  replyDraft: z.object({
    subject: z.string(),
    body: z.string(),
  }),

  meetingInvite: z.object({
    title: z.string(),
    datetimeISO: z.string(),
    ics: z.string(),
  }),

  claims: z.array(ExtractedClaimSchema),

  notes: z.object({
    whatIDid: z.array(z.string()),
    uncertainties: z.array(z.string()),
  }),
});

const FinalSchema = GeneratedFinalSchema.extend({
  claims: z.array(VerifiedClaimSchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  conflicts: z.array(EvidenceConflictSchema).default([]),
  evidence_quality_score: z.number().min(0).max(1).default(0),
});

const RunRequestSchema = z.object({
  plan: z.object({
    goal: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.string(),
            desc: z.string().optional(),
            rawQuery: z.string().optional(),
            title: z.string().optional(),
            datetimeISO: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
  }),
  emailText: z.string().optional().default(""),
  docText: z.string().optional().default(""),
  command: z.string().optional().default(""),
  threadId: z.string().optional(),
  emailThreadId: z.string().optional(),
  conversationId: z.string().optional(),
  thread_identifier: z.string().optional(),
  options: z
    .object({
      linkupDepth: z.enum(["standard", "deep"]).default("standard"),
    })
    .optional(),
});

/** ---------- Schema for Linkup-derived entity profiles ---------- */
const EntityProfileSchema = z.object({
  entity: z.string(),
  likelyOfficialDomain: z.string(), // "" if unknown
  whatItIs: z.string(), // 1-2 lines
  likelyIndustry: z.string(), // "" if unknown
  likelyLocation: z.string(), // "" if unknown
  keyPeopleOrRoles: z.array(z.string()),
  legitimacySignals: z.array(z.string()),
  redFlags: z.array(z.string()),
  sourceEvidence: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      whyRelevant: z.string(),
    })
  ),
});

/** ---------- Helper: tomorrow 3pm New York (EST in Feb) ---------- */
function tomorrowAt3pmNYISO(): string {
  const now = new Date();
  const t = new Date(now);
  t.setDate(now.getDate() + 1);

  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}T15:00:00-05:00`;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractThreadIdentifier(payload: z.infer<typeof RunRequestSchema>): string | undefined {
  return (
    asOptionalString(payload.thread_identifier) ||
    asOptionalString(payload.threadId) ||
    asOptionalString(payload.emailThreadId) ||
    asOptionalString(payload.conversationId)
  );
}

function textLength(value: string | undefined): number {
  return typeof value === "string" ? value.length : 0;
}

function extractJsonObjectFromText(value: string): string {
  const trimmed = value.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return withoutFence;
  }

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutFence.slice(firstBrace, lastBrace + 1);
  }

  return withoutFence;
}

function parsePromptManagedFinalOutput(rawText: string) {
  const normalizedJson = extractJsonObjectFromText(rawText);
  return GeneratedFinalSchema.parse(JSON.parse(normalizedJson));
}

/** ---------- Convert research array into per-entity buckets ---------- */
function groupResearchByEntity(plan: RunPlan, research: ResearchEvent[]) {
  const searchSteps = plan.steps.filter((s) => s.type === "redact_and_search");
  const searches = research.filter((r): r is SearchResearch => r.type === "search");

  const perEntity: Array<{ entityHint: string; query: string; results: NormalizedLinkupResult[] }> = [];

  for (let i = 0; i < searchSteps.length; i++) {
    const step = searchSteps[i];
    const search = searches[i];
    const query = search?.data.query || step.rawQuery || "";
    const results = search?.data.results || [];
    const entityHint = (query.split(",")[0] || query).split(" company")[0].trim();
    perEntity.push({ entityHint, query, results });
  }

  return perEntity;
}

function deriveAnalysisSectionHint(command: string, emailText: string, docText: string): {
  sectionType: AnalysisSectionType;
  title: string;
  reason: string;
} {
  const text = `${command}\n${emailText}\n${docText}`.toLowerCase();

  const hasContract = /\b(contract|agreement|msa|nda|terms|indemn|liability|governing law|clause|legal)\b/.test(text);
  const hasSecurity = /\b(phish|phishing|credential|password|mfa|security|malware|spoof|suspicious link|attachment)\b/.test(
    text
  );
  const hasFinance = /\b(payment|invoice|wire|ach|bank details|beneficiary|refund|billing|remittance)\b/.test(text);
  const hasScheduling = /\b(deadline|schedule|meeting|timeline|eta|due date|calendar|availability)\b/.test(text);
  const hasOperations = /\b(outage|incident|ticket|support|bug|deployment|uptime|sla)\b/.test(text);

  if (hasContract) {
    return {
      sectionType: "contract",
      title: "Contract Risks",
      reason: "Legal/contract terms detected in user command or content.",
    };
  }
  if (hasSecurity) {
    return {
      sectionType: "security",
      title: "Security Findings",
      reason: "Security/phishing indicators detected in user command or content.",
    };
  }
  if (hasFinance) {
    return {
      sectionType: "finance",
      title: "Payment & Fraud Risks",
      reason: "Payment/invoice context detected in user command or content.",
    };
  }
  if (hasScheduling) {
    return {
      sectionType: "scheduling",
      title: "Execution & Timeline Risks",
      reason: "Scheduling/deadline context detected in user command or content.",
    };
  }
  if (hasOperations) {
    return {
      sectionType: "operations",
      title: "Operational Risks",
      reason: "Support/operations context detected in user command or content.",
    };
  }

  return {
    sectionType: "general",
    title: "Key Risks & Actions",
    reason: "No dominant contract/security/finance/ops/scheduling context detected.",
  };
}

function buildFinalSynthesisPromptVariables(args: {
  prompt: string;
  command: string;
  emailText: string;
  docText: string;
  entityCandidates: ReturnType<typeof extractEntityCandidatesFromContext>;
  perEntityResearch: ReturnType<typeof groupResearchByEntity>;
  profiles: Array<z.infer<typeof EntityProfileSchema>>;
  analysisSectionHint: ReturnType<typeof deriveAnalysisSectionHint>;
  meetingTitle: string;
  meetingDatetimeISO: string;
  meetingICS: string;
}): PromptVariables {
  return {
    full_prompt: args.prompt,
    user_command: args.command,
    email_text: args.emailText,
    document_text: args.docText,
    entity_candidates_json: JSON.stringify(args.entityCandidates, null, 2),
    linkup_evidence_json: JSON.stringify(args.perEntityResearch, null, 2),
    entity_profiles_json: JSON.stringify(args.profiles, null, 2),
    analysis_section_hint_json: JSON.stringify(args.analysisSectionHint, null, 2),
    meeting_title: args.meetingTitle,
    meeting_datetime_iso: args.meetingDatetimeISO,
    meeting_ics: args.meetingICS,
  };
}

function entityProfileCacheKey(args: {
  entity: string;
  query: string;
  depth: LinkupDepth;
}): string {
  const raw = `${args.entity.toLowerCase()}|${args.query.toLowerCase()}|${args.depth}`;
  return createHash("sha256").update(raw).digest("hex");
}

async function hasMongoCache(): Promise<boolean> {
  if (!process.env.MONGODB_URI) return false;
  try {
    await connectMongo();
    return true;
  } catch {
    return false;
  }
}

async function getCachedProfile(args: {
  entity: string;
  query: string;
  depth: LinkupDepth;
}): Promise<z.infer<typeof EntityProfileSchema> | null> {
  const key = entityProfileCacheKey(args);
  const cachedRaw = (await EntityProfileCacheModel.findOne({
    cacheKey: key,
    expiresAt: { $gt: new Date() },
  })
    .lean()
    .exec()) as unknown;
  if (!cachedRaw || Array.isArray(cachedRaw)) return null;

  const cached = cachedRaw as { _id: unknown; profile?: unknown };
  if (!cached.profile) return null;

  const parsed = EntityProfileSchema.safeParse(cached.profile);
  if (!parsed.success) return null;

  await EntityProfileCacheModel.updateOne(
    { _id: cached._id },
    { $set: { lastAccessedAt: new Date() } }
  ).exec();

  return parsed.data;
}

async function saveCachedProfile(args: {
  entity: string;
  query: string;
  depth: LinkupDepth;
  profile: z.infer<typeof EntityProfileSchema>;
}): Promise<void> {
  const key = entityProfileCacheKey(args);
  const now = new Date();
  const ttlMs = args.depth === "deep" ? 7 * 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs);

  await EntityProfileCacheModel.updateOne(
    { cacheKey: key },
    {
      $set: {
        cacheKey: key,
        entity: args.entity,
        entityType: "unknown",
        query: args.query,
        depth: args.depth,
        profile: args.profile,
        confidence: Math.max(0, 100 - Math.round(args.profile.redFlags.length * 15)),
        sourceUrls: args.profile.sourceEvidence.map((s) => s.url).filter(Boolean),
        expiresAt,
        lastAccessedAt: now,
      },
    },
    { upsert: true }
  ).exec();
}

export async function POST(req: Request) {
  const session = await getServerSession().catch(() => null);
  const offline = getOfflineRuntimeConfig();
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id") ||
    undefined;
  const baseTraceMetadata: AegisRespanMetadataInput = {
    service: "aegis-desk",
    surface: "run",
    workflow_type: "run",
    endpoint: "/api/run",
    search_provider: "linkup",
    fallback_triggered: false,
    offline_mode: offline.state,
    customer_identifier: session?.id,
    request_id: requestId,
  };

  return withAegisWorkflowSpan(
    {
      name: "run.request",
      version: RUN_TRACE_VERSION,
      metadata: baseTraceMetadata,
    },
    async () => {
      try {
        const validation = await withAegisTaskSpan(
          {
            name: "run.request_validation",
            version: RUN_TRACE_VERSION,
            metadata: {
              tool_name: "zod",
              ...baseTraceMetadata,
            },
          },
          async () => {
            if (isOfflineEnforced(offline)) {
              addAegisSpanEvent("run.offline_blocked", {
                offline_mode: offline.state,
              });

              return {
                offlineResponse: Response.json(
                  {
                    error: "Offline mode enforced",
                    detail:
                      "Run execution is disabled in enforced offline mode because it depends on remote web/model tools.",
                    offlineState: offline.state,
                  },
                  { status: 503 }
                ),
              };
            }

            const payload = RunRequestSchema.parse(await req.json());
            const threadIdentifier = extractThreadIdentifier(payload);

            addAegisSpanEvent("run.inputs_validated", {
              plan_steps: payload.plan.steps.length,
              email_chars: textLength(payload.emailText),
              doc_chars: textLength(payload.docText),
              command_chars: textLength(payload.command),
              has_thread_identifier: Boolean(threadIdentifier),
            });

            return { payload, threadIdentifier };
          }
        );

        if ("offlineResponse" in validation) {
          return validation.offlineResponse;
        }

        const { payload, threadIdentifier } = validation;
        const traceMetadata: AegisRespanMetadataInput = {
          ...baseTraceMetadata,
          thread_identifier: threadIdentifier,
        };
        annotateAegisCurrentSpan(traceMetadata);

        const plan: RunPlan = payload.plan as RunPlan;
        const { emailText, docText, command } = payload;
        const linkupDepth: LinkupDepth = payload.options?.linkupDepth ?? "standard";

        const ledger: Array<Record<string, unknown>> = [];
        const research: ResearchEvent[] = [];
        const rawSearchBatches: Array<{ query: string; results: RawResearchResult[] }> = [];
        const mongoCacheReady = await hasMongoCache();

        const log = (type: string, message: string, data?: unknown) => {
          ledger.push({ ts: new Date().toISOString(), type, message, data });
        };

        log("plan", "Plan received", plan);
        log("command", "User command received", { command, linkupDepth });

        addAegisSpanEvent("run.plan_received", {
          plan_steps: plan.steps.length,
          linkup_depth: linkupDepth,
        });

        await withAegisTaskSpan(
          {
            name: "run.plan_execution",
            version: RUN_TRACE_VERSION,
            metadata: {
              ...traceMetadata,
              tool_name: "plan_executor",
              search_provider: "linkup",
            },
          },
          async () => {
            for (const step of plan.steps) {
              log("step_start", `Starting step ${step.id}`, step);

              if (step.type === "redact_and_search") {
                await withAegisTaskSpan(
                  {
                    name: "run.redact_and_search",
                    version: RUN_TRACE_VERSION,
                    metadata: {
                      ...traceMetadata,
                      tool_name: "linkup",
                      search_provider: "linkup",
                    },
                  },
                  async () => {
                    const rawQuery = step.rawQuery || "";
                    const redacted = privacyFirewall(rawQuery);

                    research.push({
                      type: "redaction",
                      message: "Redacted query before Linkup search",
                      data: { rawQuery, safeQuery: redacted.safeQuery, removed: redacted.removed },
                    });

                    log("redaction", "Privacy firewall applied", {
                      removed: redacted.removed,
                      safeQuery: redacted.safeQuery,
                    });

                    const response = (await linkup.search({
                      query: redacted.safeQuery,
                      depth: linkupDepth,
                      outputType: "searchResults",
                      includeImages: false,
                    })) as {
                      results?: Array<{
                        title?: string;
                        name?: string;
                        url?: string;
                        snippet?: string;
                        content?: string;
                      }>;
                    };

                    const rawResults: RawResearchResult[] = (response.results ?? [])
                      .slice(0, 8)
                      .map((r) => ({
                        title: r.title || r.name || "Untitled",
                        url: r.url || "",
                        snippet: (r.snippet || r.content || "").slice(0, 360),
                      }));
                    const results: NormalizedLinkupResult[] = scoreResultsForQuery(
                      redacted.safeQuery,
                      rawResults
                    );
                    rawSearchBatches.push({ query: redacted.safeQuery, results: rawResults });

                    research.push({
                      type: "search",
                      message: step.desc || "Linkup search",
                      data: { query: redacted.safeQuery, depth: linkupDepth, results },
                    });

                    addAegisSpanEvent("run.search_completed", {
                      results_count: results.length,
                      query_chars: redacted.safeQuery.length,
                    });

                    log("search", "Linkup search completed", {
                      query: redacted.safeQuery,
                      depth: linkupDepth,
                      resultsCount: results.length,
                    });
                  }
                );
              }

              if (step.type === "create_ics") {
                await withAegisTaskSpan(
                  {
                    name: "run.create_ics",
                    version: RUN_TRACE_VERSION,
                    metadata: {
                      ...traceMetadata,
                      tool_name: "ics",
                    },
                  },
                  async () => {
                    const title = step.title || "Follow-up Meeting";
                    const datetimeISO = tomorrowAt3pmNYISO();
                    const ics = createICS(title, datetimeISO);

                    step.datetimeISO = datetimeISO;
                    step._ics = ics.ics;

                    addAegisSpanEvent("run.ics_created", {
                      title_chars: title.length,
                    });

                    log("calendar", "ICS generated", { title, datetimeISO });
                  }
                );
              }

              if (step.type === "verify_entity_authenticity") {
                log("intent", "Entity authenticity verification planned", { desc: step.desc });
              }
              if (step.type === "analyze_contract_risks") {
                log("intent", "Contract risk analysis planned", { desc: step.desc });
              }
              if (step.type === "extract") {
                log("intent", "Extraction/summarization planned", { desc: step.desc });
              }
              if (step.type === "draft_reply") {
                log("intent", "Reply drafting planned", { desc: step.desc });
              }

              log("step_done", `Completed step ${step.id}`);
            }
          }
        );

        const evidenceSummary = await withAegisTaskSpan(
          {
            name: "run.evidence_aggregation",
            version: RUN_TRACE_VERSION,
            metadata: {
              ...traceMetadata,
              tool_name: "evidence_summary",
              search_provider: "linkup",
            },
          },
          async () => {
            const summary = summarizeResearchEvidence(rawSearchBatches);

            addAegisSpanEvent("run.evidence_summarized", {
              evidence_count: summary.evidence.length,
              conflict_count: summary.conflicts.length,
            });

            log("evidence", "Scored retrieval evidence and checked for conflicts", {
              evidenceCount: summary.evidence.length,
              conflicts: summary.conflicts.length,
              evidenceQualityScore: summary.evidence_quality_score,
            });

            annotateAegisCurrentSpan({
              ...traceMetadata,
              evidence_count: summary.evidence.length,
            });

            return summary;
          }
        );

        const perEntityResearch = groupResearchByEntity(plan, research);
        const entityCandidates = extractEntityCandidatesFromContext({
          emailText,
          docText,
          searchQueries: perEntityResearch.map((e) => e.query),
          maxEntities: 6,
        });
        const entities = entityCandidates.map((entry) => entry.name);

        addAegisSpanEvent("run.entity_candidates_extracted", {
          candidate_count: entityCandidates.length,
          research_groups: perEntityResearch.length,
        });

        let profileCacheHits = 0;
        let profileModelCalls = 0;
        const profileTelemetryMetadata = toRespanAssociationProperties(
          buildAegisRespanMetadata({
            ...traceMetadata,
            selected_model: ENTITY_PROFILE_MODEL,
            tool_name: "entity_profile",
            search_provider: "linkup",
            evidence_count: evidenceSummary.evidence.length,
            fallback_triggered: false,
          })
        );
        const profiles = await withAegisTaskSpan(
          {
            name: "run.entity_profile_generation",
            version: RUN_TRACE_VERSION,
            metadata: {
              ...traceMetadata,
              selected_model: ENTITY_PROFILE_MODEL,
              tool_name: "entity_profile",
              search_provider: "linkup",
              evidence_count: evidenceSummary.evidence.length,
            },
          },
          async () => {
            const collectedProfiles: Array<z.infer<typeof EntityProfileSchema>> = [];

            for (const e of perEntityResearch) {
              if (mongoCacheReady) {
                const cached = await getCachedProfile({
                  entity: e.entityHint,
                  query: e.query,
                  depth: linkupDepth,
                });
                if (cached) {
                  profileCacheHits += 1;
                  collectedProfiles.push(cached);
                  addAegisSpanEvent("run.entity_profile_cache_hit", {
                    cache_hits: profileCacheHits,
                  });
                  log("research_profile_cache_hit", "Loaded entity profile from cache", {
                    entity: e.entityHint,
                    query: e.query,
                    depth: linkupDepth,
                  });
                  continue;
                }
              }

              const profilePrompt = `
You are a research analyst. Build a compact entity profile ONLY from the provided Linkup search results.

Rules:
- Do NOT invent facts.
- If a field is unknown, set it to "" or [].
- If results suggest fiction/franchise mismatch OR different entity (name collision), include that in redFlags.
- likelyOfficialDomain must be a bare domain like "example.com" if present, else "".
- Use only the URLs/snippets given.
- Choose up to 4 sourceEvidence items.

ENTITY_HINT: ${e.entityHint}
SEARCH_QUERY: ${e.query}

SEARCH_RESULTS_JSON:
${JSON.stringify(e.results || [], null, 2)}

Return STRICT JSON matching this schema exactly:
{
  "entity": "...",
  "likelyOfficialDomain": "",
  "whatItIs": "",
  "likelyIndustry": "",
  "likelyLocation": "",
  "keyPeopleOrRoles": [],
  "legitimacySignals": [],
  "redFlags": [],
  "sourceEvidence": [
    {"title":"", "url":"", "snippet":"", "whyRelevant":""}
  ]
}
`;

              profileModelCalls += 1;

              const profileObj = await withAegisTaskSpan(
                {
                  name: "run.entity_profile_model_call",
                  version: RUN_TRACE_VERSION,
                  metadata: {
                    ...traceMetadata,
                    selected_model: ENTITY_PROFILE_MODEL,
                    tool_name: "entity_profile",
                    search_provider: "linkup",
                    cache_hit: false,
                    evidence_count: evidenceSummary.evidence.length,
                  },
                },
                async () =>
                  generateObject({
                    model: openai(ENTITY_PROFILE_MODEL),
                    schema: EntityProfileSchema,
                    prompt: profilePrompt,
                    experimental_telemetry: {
                      isEnabled: isRespanEnabled(),
                      functionId: "run.entity_profile_model_call",
                      recordInputs: false,
                      recordOutputs: false,
                      metadata: profileTelemetryMetadata,
                    },
                  })
              );

              collectedProfiles.push(profileObj.object);
              if (mongoCacheReady) {
                await saveCachedProfile({
                  entity: e.entityHint,
                  query: e.query,
                  depth: linkupDepth,
                  profile: profileObj.object,
                });
              }
            }

            return collectedProfiles;
          }
        );

        addAegisSpanEvent("run.entity_profiles_ready", {
          profile_count: profiles.length,
          cache_hits: profileCacheHits,
          model_calls: profileModelCalls,
        });

        log("research_profile", "Entity profiles extracted from Linkup evidence", {
          count: profiles.length,
          entities: profiles.map((p) => p.entity),
          entityCandidates,
          cacheEnabled: mongoCacheReady,
          cacheHits: profileCacheHits,
          modelCalls: profileModelCalls,
        });

        const meetingStep = plan.steps.find((s) => s.type === "create_ics");
        const meetingTitle = meetingStep?.title || "Follow-up Meeting";
        const meetingDatetimeISO = meetingStep?.datetimeISO || tomorrowAt3pmNYISO();
        const meetingICS = meetingStep?._ics || "";

        const analysisSectionHint = deriveAnalysisSectionHint(command, emailText, docText);
        const promptManagedSynthesisEnabled =
          RESPAN_PROMPTS_ENABLED && Boolean(RESPAN_PROMPT_ID_SYNTHESIS);
        const synthesisTelemetryMetadata = toRespanAssociationProperties(
          buildAegisRespanMetadata({
            ...traceMetadata,
            selected_model: FINAL_SYNTHESIS_MODEL,
            tool_name: "final_synthesis",
            search_provider: "linkup",
            evidence_count: evidenceSummary.evidence.length,
            fallback_triggered: false,
          })
        );

        log("synthesis", "Generating user-facing final output using LLM", {
          evidenceQueries: perEntityResearch.map((e) => e.query),
          entities,
          analysisSectionHint,
        });

        const prompt = `
You are an AGI-inspired desktop intelligence agent producing the FINAL user-facing deliverable.

User asked: "${command}"

GOAL:
- Summarize the email + document context.
- Build one dynamic analysis section with 3-6 findings (severity + suggested edits), based on the user command and mail type.
- Verify company/person/entity background using Linkup results ONLY.
- Output genuineness verdicts with a justified uncertaintyPct that is NOT random.
- Extract top-level raw claims from EMAIL_TEXT and DOCUMENT_TEXT only.

CRITICAL RULES:
- You MUST base verdict and uncertaintyPct on the extracted ENTITY_PROFILES_EXTRACTED_FROM_LINKUP only.
- Do NOT invent sources or facts not present in profiles.
- analysisSection.title must be context-aware.
- Use "Contract Risks" only when legal/contract context is actually present.
- For non-contract mails, use specific titles like "Security Findings", "Payment & Fraud Risks", "Operational Risks", "Execution & Timeline Risks", or "Key Risks & Actions".
- uncertaintyPct must be driven by:
  (a) profile completeness: official domain + whatItIs + (industry or location)
  (b) consistency: at least 2 sources agree vs sources conflict
  (c) redFlags count/severity (name collision, fiction/franchise, mismatched entity)
- Guidance for uncertaintyPct:
  - If official domain is present AND whatItIs is clear AND redFlags are empty/low → uncertaintyPct should be 5-25.
- If missing official domain OR only directories/aggregators OR identity conflicts → uncertaintyPct should be 55-85.
- If strong franchise/fiction mismatch or strong spoof signals → verdict suspicious and uncertaintyPct should be 5-25 (high confidence it's suspicious).
- Proof must be brief (2-4 items) using profile.sourceEvidence (title/url/snippet). snippet can be "".
- Ensure replyDraft is aligned to BOTH: analysisSection findings + entity verification outcome.
- Claims are raw asserted statements, NOT verified facts.
- Do NOT use Linkup evidence to invent or validate claims.
- Extract claims only with these types: "sender_identity", "organization", "financial_request", "urgency".
- sender_identity: who the sender claims to be or represent.
- organization: what company or organization is claimed or referenced as the acting party.
- financial_request: requests for payment, invoice handling, bank detail change, refund, ACH, wire, beneficiary, or remittance action.
- urgency: explicit deadline, emergency framing, pressure, or immediate-action claim.
- Use [] if no claims are present. Prefer 0 to 6 total claims.
- claim confidence is extraction confidence in [0,1], not truth confidence.

EMAIL_TEXT:
${emailText}

DOCUMENT_TEXT:
${docText}

ENTITY_CANDIDATES:
${JSON.stringify(entityCandidates, null, 2)}

LINKUP_EVIDENCE_BY_SEARCH (JSON):
${JSON.stringify(perEntityResearch, null, 2)}

ENTITY_PROFILES_EXTRACTED_FROM_LINKUP (JSON):
${JSON.stringify(profiles, null, 2)}

ANALYSIS_SECTION_HINT (JSON):
${JSON.stringify(analysisSectionHint, null, 2)}

MEETING (already generated):
Title: ${meetingTitle}
datetimeISO: ${meetingDatetimeISO}
ICS: ${meetingICS}

Return STRICT JSON matching the schema exactly.
`;
        const promptVariables = buildFinalSynthesisPromptVariables({
          prompt,
          command,
          emailText,
          docText,
          entityCandidates,
          perEntityResearch,
          profiles,
          analysisSectionHint,
          meetingTitle,
          meetingDatetimeISO,
          meetingICS,
        });

        let synthesisMode: "respan_prompt" | "inline_prompt" = "inline_prompt";
        let synthesisFallbackTriggered = false;

        const finalObj = await withAegisTaskSpan(
          {
            name: "run.final_synthesis",
            version: RUN_TRACE_VERSION,
            metadata: {
              ...traceMetadata,
              selected_model: promptManagedSynthesisEnabled ? undefined : FINAL_SYNTHESIS_MODEL,
              tool_name: promptManagedSynthesisEnabled ? "respan_prompt" : "final_synthesis",
              search_provider: "linkup",
              evidence_count: evidenceSummary.evidence.length,
              fallback_triggered: false,
            },
          },
          async () => {
            if (promptManagedSynthesisEnabled && RESPAN_PROMPT_ID_SYNTHESIS) {
              try {
                addAegisSpanEvent("run.final_synthesis_prompt_managed_attempt", {
                  prompt_id: RESPAN_PROMPT_ID_SYNTHESIS,
                });

                log("synthesis_prompt", "Attempting Respan-managed synthesis prompt", {
                  promptId: RESPAN_PROMPT_ID_SYNTHESIS,
                });

                const promptResponseText = await callRespanPrompt({
                  promptId: RESPAN_PROMPT_ID_SYNTHESIS,
                  variables: promptVariables,
                });
                const parsedPromptResponse = parsePromptManagedFinalOutput(promptResponseText);

                synthesisMode = "respan_prompt";

                annotateAegisCurrentSpan({
                  ...traceMetadata,
                  tool_name: "respan_prompt",
                  evidence_count: evidenceSummary.evidence.length,
                  parse_success: true,
                  schema_validation_result: "passed",
                  fallback_triggered: false,
                });

                addAegisSpanEvent("run.final_synthesis_prompt_managed_success", {
                  prompt_id: RESPAN_PROMPT_ID_SYNTHESIS,
                });

                return { object: parsedPromptResponse };
              } catch (error: unknown) {
                synthesisFallbackTriggered = true;

                if (error instanceof Error) {
                  recordAegisSpanException(error);
                }

                const detail = error instanceof Error ? error.message : String(error);
                addAegisSpanEvent("run.final_synthesis_prompt_managed_fallback", {
                  prompt_id: RESPAN_PROMPT_ID_SYNTHESIS,
                  detail: detail.slice(0, 240),
                });

                log(
                  "synthesis_prompt_fallback",
                  "Respan-managed synthesis failed; falling back to inline prompt",
                  {
                    promptId: RESPAN_PROMPT_ID_SYNTHESIS,
                    detail,
                  }
                );
              }
            }

            const inlineResult = await generateObject({
              model: openai(FINAL_SYNTHESIS_MODEL),
              schema: GeneratedFinalSchema,
              prompt,
              experimental_telemetry: {
                isEnabled: isRespanEnabled(),
                functionId: "run.final_synthesis",
                recordInputs: false,
                recordOutputs: false,
                metadata: synthesisTelemetryMetadata,
              },
            });

            synthesisMode = "inline_prompt";

            annotateAegisCurrentSpan({
              ...traceMetadata,
              selected_model: FINAL_SYNTHESIS_MODEL,
              tool_name: "final_synthesis",
              evidence_count: evidenceSummary.evidence.length,
              parse_success: true,
              schema_validation_result: "passed",
              fallback_triggered: synthesisFallbackTriggered,
            });

            if (synthesisFallbackTriggered) {
              addAegisSpanEvent("run.final_synthesis_inline_fallback_used", {
                selected_model: FINAL_SYNTHESIS_MODEL,
              });
            }

            return inlineResult;
          }
        );

        const responsePayload = await withAegisTaskSpan(
          {
            name: "run.response_assembly",
            version: RUN_TRACE_VERSION,
            metadata: {
              ...traceMetadata,
              selected_model:
                synthesisMode === "inline_prompt" ? FINAL_SYNTHESIS_MODEL : undefined,
              tool_name: "final_formatter",
              search_provider: "linkup",
              evidence_count: evidenceSummary.evidence.length,
              fallback_triggered: synthesisFallbackTriggered,
            },
          },
          async () => {
            const parsedFinal = FinalSchema.parse({
              ...finalObj.object,
              claims: attachClaimVerification(finalObj.object.claims ?? [], {
                emailText,
                docText,
              }),
              evidence: evidenceSummary.evidence,
              conflicts: evidenceSummary.conflicts,
              evidence_quality_score: evidenceSummary.evidence_quality_score,
            });
            const final = formatFinalOutput({
              final: parsedFinal,
              plan,
              ledger,
              modelsUsed: [
                `openai:${ENTITY_PROFILE_MODEL}:entity_profile`,
                synthesisMode === "respan_prompt" && RESPAN_PROMPT_ID_SYNTHESIS
                  ? `respan_prompt:${RESPAN_PROMPT_ID_SYNTHESIS}:final_synthesis`
                  : `openai:${FINAL_SYNTHESIS_MODEL}:final_synthesis${synthesisFallbackTriggered ? ":fallback" : ""}`,
              ],
            });

            addAegisSpanEvent("run.response_ready", {
              evidence_count: final.evidence?.length ?? 0,
              profile_count: profiles.length,
              entity_verdicts: final.entityVerdicts?.length ?? 0,
            });

            log("output", "Final output produced", {
              synthesisMode,
              synthesisFallbackTriggered,
              entityVerdicts: final.entityVerdicts?.length ?? 0,
              claimCount: final.claims?.length ?? 0,
              evidenceCount: final.evidence?.length ?? 0,
              conflictCount: final.conflicts?.length ?? 0,
              evidenceQualityScore: final.evidence_quality_score ?? 0,
              decisionAction: final.decision?.final_action ?? "",
              uncertaintyLevel: final.uncertainty?.level ?? "",
              auditFlags: final.audit_trace?.flags?.length ?? 0,
              analysisTitle: final.analysisSection?.title ?? "",
              analysisFindings: final.analysisSection?.findings?.length ?? 0,
              hasICS: !!final.meetingInvite?.ics,
            });

            annotateAegisCurrentSpan({
              ...traceMetadata,
              selected_model:
                synthesisMode === "inline_prompt" ? FINAL_SYNTHESIS_MODEL : undefined,
              search_provider: "linkup",
              evidence_count: final.evidence?.length ?? evidenceSummary.evidence.length,
              parse_success: true,
              schema_validation_result: "passed",
              fallback_triggered: synthesisFallbackTriggered,
            });

            return {
              ok: true,
              final,
              plan,
              ledger,
              research,
              profiles,
              evidence: final.evidence,
              conflicts: final.conflicts,
              evidence_quality_score: final.evidence_quality_score,
              runConfig: { linkupDepth },
            };
          }
        );

        return Response.json(responsePayload);
      } catch (err: unknown) {
        console.error("Run error:", err);
        if (err instanceof Error) {
          recordAegisSpanException(err);
        }
        const detail = err instanceof Error ? err.message : String(err);
        return Response.json({ error: "Run failed", detail }, { status: 500 });
      }
    }
  );
}
