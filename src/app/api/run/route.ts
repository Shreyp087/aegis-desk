import { LinkupClient } from "linkup-sdk";
import { privacyFirewall } from "@/lib/tools/privacy";
import { createICS } from "@/lib/tools/ics";

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const linkup = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY! });

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

  contractRisks: z.array(
    z.object({
      risk: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      whyItMatters: z.string(),
      suggestedEdit: z.string(),
    })
  ),

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

/** ---------- Extract likely entities from plan + text (lightweight) ---------- */
function extractEntityCandidates(plan: any, emailText: string, docText: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /\b([A-Z][A-Za-z0-9&.\- ]{2,}?\s(?:LLC|Inc|Corp|Corporation|Ltd|Limited))\b/g,
  ];

  const combined = `${emailText}\n${docText}`;
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(combined)) !== null) {
      candidates.add(m[1].trim());
    }
  }

  // fallback: infer from search queries if regex found nothing
  const searchSteps = (plan?.steps || []).filter((s: any) => s.type === "redact_and_search");
  if (candidates.size === 0) {
    for (const s of searchSteps) {
      const q = (s.rawQuery || "").trim();
      const guess = q.split(/\s+/).slice(0, 4).join(" ").trim();
      if (guess) candidates.add(guess);
    }
  }

  return Array.from(candidates).slice(0, 4);
}

/** ---------- Convert research array into per-entity buckets ---------- */
function groupResearchByEntity(plan: any, research: any[]) {
  const searchSteps = (plan?.steps || []).filter((s: any) => s.type === "redact_and_search");
  const searches = research.filter((r: any) => r.type === "search");

  const perEntity: Array<{ entityHint: string; query: string; results: any[] }> = [];

  for (let i = 0; i < searchSteps.length; i++) {
    const step = searchSteps[i];
    const search = searches[i];
    const query = search?.data?.query || step?.rawQuery || "";
    const results = search?.data?.results || [];
    const entityHint = (query.split(",")[0] || query).split(" company")[0].trim();
    perEntity.push({ entityHint, query, results });
  }

  return perEntity;
}

/** ---------- Utility: brief deadline extraction (hackathon-safe) ---------- */
function extractDeadlines(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bby\s+(end of day|eod|end of week)\b/gi,
    /\bwithin\s+\d+\s+(days|weeks)\b/gi,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\btomorrow\b/gi,
    /\bnext week\b/gi,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 8);
}

export async function POST(req: Request) {
  try {
    const { plan, emailText = "", docText = "", command = "" } = await req.json();

    const ledger: any[] = [];
    const research: any[] = [];

    const log = (type: string, message: string, data?: any) => {
      ledger.push({ ts: new Date().toISOString(), type, message, data });
    };

    log("plan", "Plan received", plan);
    log("command", "User command received", { command });

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

        const response: any = await linkup.search({
          query: redacted.safeQuery,
          depth: "standard",
          outputType: "searchResults",
          includeImages: false,
        });

        const results = (response?.results ?? []).slice(0, 6).map((r: any) => ({
          title: r?.title ?? "Untitled",
          url: r?.url ?? "",
          snippet: r?.snippet ?? "",
        }));

        research.push({
          type: "search",
          message: step.desc || "Linkup search",
          data: { query: redacted.safeQuery, results },
        });

        log("search", "Linkup search completed", {
          query: redacted.safeQuery,
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
    const entities = extractEntityCandidates(plan, emailText, docText);

    // --- Build Linkup-derived entity profiles (key upgrade) ---
    const profiles: any[] = [];
    for (const e of perEntityResearch) {
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
    }

    log("research_profile", "Entity profiles extracted from Linkup evidence", {
      count: profiles.length,
      entities: profiles.map((p: any) => p.entity),
    });

    const meetingStep = plan.steps.find((s: any) => s.type === "create_ics");
    const meetingTitle = meetingStep?.title || "Follow-up Meeting";
    const meetingDatetimeISO = meetingStep?.datetimeISO || tomorrowAt3pmNYISO();
    const meetingICS = meetingStep?._ics || "";

    const deadlines = extractDeadlines(`${emailText}\n${docText}`);

    log("synthesis", "Generating user-facing final output using LLM", {
      evidenceQueries: perEntityResearch.map((e) => e.query),
      entities,
    });

    // --- Final synthesis: LLM decides genuineness/uncertainty based on extracted profiles ---
    const prompt = `
You are an AGI-inspired desktop intelligence agent producing the FINAL user-facing deliverable.

User asked: "${command}"

GOAL:
- Summarize the email + contract.
- Flag risks (3-6) with severity + suggested edits.
- Verify company/entity background using Linkup results ONLY.
- Output genuineness verdicts with a justified uncertaintyPct that is NOT random.

CRITICAL RULES:
- You MUST base verdict and uncertaintyPct on the extracted ENTITY_PROFILES_EXTRACTED_FROM_LINKUP only.
- Do NOT invent sources or facts not present in profiles.
- uncertaintyPct must be driven by:
  (a) profile completeness: official domain + whatItIs + (industry or location)
  (b) consistency: at least 2 sources agree vs sources conflict
  (c) redFlags count/severity (name collision, fiction/franchise, mismatched entity)
- Guidance for uncertaintyPct:
  - If official domain is present AND whatItIs is clear AND redFlags are empty/low → uncertaintyPct should be 5–25.
  - If missing official domain OR only directories/aggregators OR identity conflicts → uncertaintyPct should be 55–85.
  - If strong franchise/fiction mismatch or strong spoof signals → verdict suspicious and uncertaintyPct should be 5–25 (high confidence it's suspicious).
- Proof must be brief (2-4 items) using profile.sourceEvidence (title/url/snippet). snippet can be "".
- Ensure replyDraft is a negotiation email aligned to BOTH: contract risks + entity verification outcome.

EMAIL_TEXT:
${emailText}

DOCUMENT_TEXT:
${docText}

ENTITY_CANDIDATES:
${JSON.stringify(entities, null, 2)}

LINKUP_EVIDENCE_BY_SEARCH (JSON):
${JSON.stringify(perEntityResearch, null, 2)}

ENTITY_PROFILES_EXTRACTED_FROM_LINKUP (JSON):
${JSON.stringify(profiles, null, 2)}

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
      contractRisks: final.contractRisks?.length ?? 0,
      hasICS: !!final.meetingInvite?.ics,
    });

    return Response.json({ ok: true, final, plan, ledger, research, profiles });
  } catch (err: any) {
    console.error("Run error:", err);
    return Response.json(
      { error: "Run failed", detail: err?.message },
      { status: 500 }
    );
  }
}