import { LinkupClient } from "linkup-sdk";
import { privacyFirewall } from "@/lib/tools/privacy";
import { createICS } from "@/lib/tools/ics";

import { createHash } from "crypto";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { connectMongo } from "@/lib/db/mongoose";
import { extractEntityCandidatesFromContext } from "@/lib/inbox/entityProfiler";
import { EntityProfileCacheModel } from "@/lib/models/EntityProfileCache";
import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";

const linkup = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY! });

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

type NormalizedLinkupResult = {
  title: string;
  url: string;
  snippet: string;
};

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
const FinalSchema = z.object({
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

  notes: z.object({
    whatIDid: z.array(z.string()),
    uncertainties: z.array(z.string()),
  }),
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
  try {
    const offline = getOfflineRuntimeConfig();
    if (isOfflineEnforced(offline)) {
      return Response.json(
        {
          error: "Offline mode enforced",
          detail:
            "Run execution is disabled in enforced offline mode because it depends on remote web/model tools.",
          offlineState: offline.state,
        },
        { status: 503 }
      );
    }

    const payload = RunRequestSchema.parse(await req.json());
    const plan: RunPlan = payload.plan as RunPlan;
    const { emailText, docText, command } = payload;
    const linkupDepth: LinkupDepth = payload.options?.linkupDepth ?? "standard";

    const ledger: Array<Record<string, unknown>> = [];
    const research: ResearchEvent[] = [];
    const mongoCacheReady = await hasMongoCache();

    const log = (type: string, message: string, data?: unknown) => {
      ledger.push({ ts: new Date().toISOString(), type, message, data });
    };

    log("plan", "Plan received", plan);
    log("command", "User command received", { command, linkupDepth });

    // Execute steps (only redact_and_search + create_ics)
    for (const step of plan.steps) {
      log("step_start", `Starting step ${step.id}`, step);

      if (step.type === "redact_and_search") {
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
        })) as { results?: Array<{ title?: string; name?: string; url?: string; snippet?: string; content?: string }> };

        const results: NormalizedLinkupResult[] = (response.results ?? [])
          .slice(0, 8)
          .map((r) => ({
            title: r.title || r.name || "Untitled",
            url: r.url || "",
            snippet: (r.snippet || r.content || "").slice(0, 360),
          }));

        research.push({
          type: "search",
          message: step.desc || "Linkup search",
          data: { query: redacted.safeQuery, depth: linkupDepth, results },
        });

        log("search", "Linkup search completed", {
          query: redacted.safeQuery,
          depth: linkupDepth,
          resultsCount: results.length,
        });
      }

      if (step.type === "create_ics") {
        const title = step.title || "Follow-up Meeting";
        const datetimeISO = tomorrowAt3pmNYISO();

        const ics = createICS(title, datetimeISO);

        step.datetimeISO = datetimeISO;
        step._ics = ics.ics;

        log("calendar", "ICS generated", { title, datetimeISO });
      }

      // semantic steps are logged for explainability
      if (step.type === "verify_entity_authenticity") log("intent", "Entity authenticity verification planned", { desc: step.desc });
      if (step.type === "analyze_contract_risks") log("intent", "Contract risk analysis planned", { desc: step.desc });
      if (step.type === "extract") log("intent", "Extraction/summarization planned", { desc: step.desc });
      if (step.type === "draft_reply") log("intent", "Reply drafting planned", { desc: step.desc });

      log("step_done", `Completed step ${step.id}`);
    }

    // --- Prepare evidence for synthesis ---
    const perEntityResearch = groupResearchByEntity(plan, research);
    const entityCandidates = extractEntityCandidatesFromContext({
      emailText,
      docText,
      searchQueries: perEntityResearch.map((e) => e.query),
      maxEntities: 6,
    });
    const entities = entityCandidates.map((entry) => entry.name);

    // --- Build Linkup-derived entity profiles (key upgrade) ---
    const profiles: Array<z.infer<typeof EntityProfileSchema>> = [];
    for (const e of perEntityResearch) {
      if (mongoCacheReady) {
        const cached = await getCachedProfile({
          entity: e.entityHint,
          query: e.query,
          depth: linkupDepth,
        });
        if (cached) {
          profiles.push(cached);
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

      const profileObj = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: EntityProfileSchema,
        prompt: profilePrompt,
      });

      profiles.push(profileObj.object);
      if (mongoCacheReady) {
        await saveCachedProfile({
          entity: e.entityHint,
          query: e.query,
          depth: linkupDepth,
          profile: profileObj.object,
        });
      }
    }

    log("research_profile", "Entity profiles extracted from Linkup evidence", {
      count: profiles.length,
      entities: profiles.map((p) => p.entity),
      entityCandidates,
      cacheEnabled: mongoCacheReady,
    });

    const meetingStep = plan.steps.find((s) => s.type === "create_ics");
    const meetingTitle = meetingStep?.title || "Follow-up Meeting";
    const meetingDatetimeISO = meetingStep?.datetimeISO || tomorrowAt3pmNYISO();
    const meetingICS = meetingStep?._ics || "";

    const analysisSectionHint = deriveAnalysisSectionHint(command, emailText, docText);

    log("synthesis", "Generating user-facing final output using LLM", {
      evidenceQueries: perEntityResearch.map((e) => e.query),
      entities,
      analysisSectionHint,
    });

    // --- Final synthesis: LLM decides genuineness/uncertainty based on extracted profiles ---
    const prompt = `
You are an AGI-inspired desktop intelligence agent producing the FINAL user-facing deliverable.

User asked: "${command}"

GOAL:
- Summarize the email + document context.
- Build one dynamic analysis section with 3-6 findings (severity + suggested edits), based on the user command and mail type.
- Verify company/person/entity background using Linkup results ONLY.
- Output genuineness verdicts with a justified uncertaintyPct that is NOT random.

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
  - If official domain is present AND whatItIs is clear AND redFlags are empty/low → uncertaintyPct should be 5–25.
  - If missing official domain OR only directories/aggregators OR identity conflicts → uncertaintyPct should be 55–85.
- If strong franchise/fiction mismatch or strong spoof signals → verdict suspicious and uncertaintyPct should be 5–25 (high confidence it's suspicious).
- Proof must be brief (2-4 items) using profile.sourceEvidence (title/url/snippet). snippet can be "".
- Ensure replyDraft is aligned to BOTH: analysisSection findings + entity verification outcome.

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

    const finalObj = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: FinalSchema,
      prompt,
    });

    const final = finalObj.object;

    log("output", "Final output produced", {
      entityVerdicts: final.entityVerdicts?.length ?? 0,
      analysisTitle: final.analysisSection?.title ?? "",
      analysisFindings: final.analysisSection?.findings?.length ?? 0,
      hasICS: !!final.meetingInvite?.ics,
    });

    return Response.json({ ok: true, final, plan, ledger, research, profiles, runConfig: { linkupDepth } });
  } catch (err: unknown) {
    console.error("Run error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Run failed", detail },
      { status: 500 }
    );
  }
}
