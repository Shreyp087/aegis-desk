import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import {
  extractEntityCandidatesFromContext,
  type EntityCandidate,
} from "@/lib/inbox/entityProfiler";
import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";

console.log("OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);

// Hackathon-safe: compute tomorrow at 3pm New York (EST in Feb)
function tomorrowAt3pmNYISO(): string {
  const now = new Date();
  const t = new Date(now);
  t.setDate(now.getDate() + 1);

  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}T15:00:00-05:00`;
}

const PlanStepTypeEnum = z.enum([
  "extract",
  "verify_entity_authenticity",
  "redact_and_search",
  "analyze_contract_risks",
  "draft_reply",
  "create_ics",
]);

const PlanStepSchema = z
  .object({
    id: z.string(),
    type: PlanStepTypeEnum,
    desc: z.string(),
    rawQuery: z.string().optional(),
    title: z.string().optional(),
    datetimeISO: z.string().optional(),
  })
  .passthrough();

const PlannerPlanSchema = z
  .object({
    goal: z.string(),
    steps: z.array(PlanStepSchema).min(4),
  })
  .passthrough();

type PlannerPlan = z.infer<typeof PlannerPlanSchema>;
type PlannerPlanStep = z.infer<typeof PlanStepSchema>;

const SEARCH_STEP_MIN = 2;
const SEARCH_STEP_MAX = 6;

function buildSearchQueriesForEntity(entity: EntityCandidate): string[] {
  const name = entity.name.trim();
  if (!name) return [];

  if (entity.entityType === "company" || entity.entityType === "organization") {
    return [
      `${name} official website company registration LinkedIn`,
      `${name} business entity search incorporation official website`,
    ];
  }

  if (entity.entityType === "person") {
    return [
      `${name} LinkedIn official profile biography`,
      `${name} company profile official biography`,
    ];
  }

  return [
    `${name} official website LinkedIn`,
    `${name} company registration official website`,
  ];
}

function inferFallbackSearchQueries(args: {
  emailText: string;
  docText: string;
  command: string;
}): string[] {
  const entities = extractEntityCandidatesFromContext({
    emailText: args.emailText,
    docText: args.docText,
    searchQueries: [args.command],
    maxEntities: SEARCH_STEP_MAX,
  });

  const queries: string[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    for (const query of buildSearchQueriesForEntity(entity)) {
      const normalized = query.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      queries.push(query);
      if (queries.length >= SEARCH_STEP_MAX) return queries;
    }
  }

  const genericFallbacks = [
    "official website company registration LinkedIn",
    "business entity search official website leadership",
  ];

  for (const query of genericFallbacks) {
    const normalized = query.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    queries.push(query);
    if (queries.length >= SEARCH_STEP_MAX) break;
  }

  return queries;
}

function normalizeSearchSteps(args: {
  plan: PlannerPlan;
  emailText: string;
  docText: string;
  command: string;
}): PlannerPlanStep[] {
  const existing = args.plan.steps
    .filter((step) => step.type === "redact_and_search")
    .filter((step) => step.rawQuery && step.rawQuery.trim().length > 0);

  const queries: string[] = [];
  const seen = new Set<string>();

  for (const step of existing) {
    const query = step.rawQuery?.trim() || "";
    const normalized = query.toLowerCase();
    if (!query || seen.has(normalized)) continue;
    seen.add(normalized);
    queries.push(query);
    if (queries.length >= SEARCH_STEP_MAX) break;
  }

  if (queries.length < SEARCH_STEP_MIN) {
    for (const query of inferFallbackSearchQueries(args)) {
      const normalized = query.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      queries.push(query);
      if (queries.length >= SEARCH_STEP_MIN) break;
    }
  }

  const bounded = queries.slice(0, SEARCH_STEP_MAX);

  return bounded.map((query, index) => ({
    id: `search_${index + 1}`,
    type: "redact_and_search",
    desc: `Search external sources for authenticity and background signals (${index + 1}/${bounded.length}).`,
    rawQuery: query,
  }));
}

function normalizePlan(args: {
  plan: PlannerPlan;
  emailText: string;
  docText: string;
  command: string;
  fixedMeetingISO: string;
}): PlannerPlan {
  const extractStep =
    args.plan.steps.find((step) => step.type === "extract") ||
    ({
      id: "extract_1",
      type: "extract",
      desc: "Extract the main entities, deadlines, requests, and factual claims from the provided context.",
    } satisfies PlannerPlanStep);

  const searchSteps = normalizeSearchSteps(args);

  const verifyStep =
    args.plan.steps.find((step) => step.type === "verify_entity_authenticity") ||
    ({
      id: "verify_1",
      type: "verify_entity_authenticity",
      desc: "Verify the authenticity of the key external people, companies, or organizations referenced in the message.",
    } satisfies PlannerPlanStep);

  const analyzeSteps = args.plan.steps.filter(
    (step) => step.type === "analyze_contract_risks"
  );

  const draftStep =
    args.plan.steps.find((step) => step.type === "draft_reply") ||
    ({
      id: "draft_1",
      type: "draft_reply",
      desc: "Draft a concise, safe reply aligned to the verified evidence and identified risks.",
    } satisfies PlannerPlanStep);

  const icsStep = {
    ...(args.plan.steps.find((step) => step.type === "create_ics") || {
      id: "ics_1",
      type: "create_ics" as const,
      desc: "Create a follow-up calendar invite for the next review checkpoint.",
      title: "Aegis Desk Follow-up",
    }),
    datetimeISO: args.fixedMeetingISO,
  } satisfies PlannerPlanStep;

  const steps = [
    extractStep,
    verifyStep,
    ...searchSteps,
    ...analyzeSteps,
    draftStep,
    icsStep,
  ].map((step, index) => ({
    ...step,
    id: String(index + 1),
  }));

  return {
    ...args.plan,
    goal: args.plan.goal?.trim() || args.command.trim() || "Analyze the provided email and produce a structured response plan.",
    steps,
  };
}

export async function POST(req: Request) {
  try {
    const offline = getOfflineRuntimeConfig();
    if (isOfflineEnforced(offline)) {
      return Response.json(
        {
          error: "Offline mode enforced",
          detail:
            "Plan generation is disabled in enforced offline mode because it relies on remote model calls.",
          offlineState: offline.state,
        },
        { status: 503 }
      );
    }

    const { emailText, docText, command } = await req.json();

    const fixedMeetingISO = tomorrowAt3pmNYISO();

    const plannerPrompt = `
You are an AGI-inspired task planner for a desktop intelligence agent.

Your job: convert the user's command into a STRICT JSON plan.

ABSOLUTE RULES:
- Return ONLY valid JSON (no markdown, no commentary).
- Use ONLY the step types listed below (exact spelling).
- Must include BETWEEN 2 AND 6 Linkup web research steps.
- Must redact PII before web search (handled later), but your rawQuery MUST avoid personal data.
- If user asks to "verify company/person background" you MUST plan authenticity verification for each entity.
- Do NOT verify internal contract statements using web search (e.g., SLA response time). Web search is ONLY for external entity/background verification.
- Must include contract risk analysis if user asks "flag risks" or contract is present.
- Must end with a draft reply and an ICS meeting invite.
- For each proof item, include: title, url, snippet ("" if not available), reasonThisHelps.


ALLOWED STEP TYPES (exact):
- extract
- verify_entity_authenticity
- redact_and_search
- analyze_contract_risks
- draft_reply
- create_ics

LINKUP SEARCH REQUIREMENT:
- You MUST output 2 to 6 steps of type "redact_and_search" based on how many entities actually require verification.
- Use more search steps when multiple people/companies are mentioned.
- Assume Linkup search depth is STANDARD by default for cost control.
- Only suggest deep investigation language if the user explicitly asks for deep research.

QUERY QUALITY RULES (IMPORTANT):
- Queries must minimize ambiguity and avoid fictional/franchise results.
- For companies, always include at least one of:
  "company registration", "business entity search", "incorporation", "official website", "LinkedIn"
- If entity includes LLC/Corp, include that token and "registration".
- Avoid searching for phone numbers, emails, personal addresses.

MEETING TIME:
- Set datetimeISO EXACTLY to: ${fixedMeetingISO}

Return ONLY valid JSON in this exact shape:
{
  "goal": "...",
  "steps": [
    { "id":"1", "type":"extract", "desc":"..." },
    { "id":"2", "type":"verify_entity_authenticity", "desc":"..." },
    { "id":"3", "type":"redact_and_search", "desc":"...", "rawQuery":"..." },
    { "id":"4", "type":"redact_and_search", "desc":"...", "rawQuery":"..." },
    { "id":"X", "type":"analyze_contract_risks", "desc":"..." },
    { "id":"Y", "type":"draft_reply", "desc":"..." },
    { "id":"Z", "type":"create_ics", "desc":"...", "title":"...", "datetimeISO":"..." }
  ]
}

Context:
EMAIL:
${emailText}

DOC:
${docText}

COMMAND:
${command}
`;

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: plannerPrompt,
    });

    // Robust JSON extraction (handles accidental extra text)
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Planner did not return valid JSON object.");
    }

    const jsonText = result.text.slice(start, end + 1);
    const parsedPlan = PlannerPlanSchema.parse(JSON.parse(jsonText));
    const plan = normalizePlan({
      plan: parsedPlan,
      emailText,
      docText,
      command,
      fixedMeetingISO,
    });

    // Guardrails: enforce dynamic but bounded search count.
    const searchSteps = plan.steps.filter((s) => s.type === "redact_and_search");
    if (searchSteps.length < SEARCH_STEP_MIN || searchSteps.length > SEARCH_STEP_MAX) {
      throw new Error(
        `Plan must include between 2 and 6 redact_and_search steps. Got ${searchSteps.length}.`
      );
    }

    // Ensure meeting datetimeISO is correct (override if model deviated)
    const icsStep = plan.steps.find((s) => s.type === "create_ics");
    if (icsStep) {
      icsStep.datetimeISO = fixedMeetingISO;
    }

    return Response.json({ ok: true, plan });
  } catch (err: unknown) {
    console.error("Plan error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Plan failed", detail },
      { status: 500 }
    );
  }
}
