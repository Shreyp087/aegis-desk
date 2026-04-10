import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import {
  extractEntityCandidatesFromContext,
  type EntityCandidate,
} from "@/lib/inbox/entityProfiler";
import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";
import {
  addAegisSpanEvent,
  annotateAegisCurrentSpan,
  buildAegisRespanMetadata,
  isRespanEnabled,
  toRespanAssociationProperties,
  withAegisTaskSpan,
  withAegisWorkflowSpan,
  type AegisRespanMetadataInput,
} from "@/lib/observability/respan";

console.log("OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);

const PLANNER_MODEL = "gpt-4o-mini";
const PLAN_TRACE_VERSION = 1;

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

type PlanRouteRequestBody = {
  emailText: string;
  docText: string;
  command: string;
  threadId?: unknown;
  emailThreadId?: unknown;
  conversationId?: unknown;
  thread_identifier?: unknown;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractThreadIdentifier(body: PlanRouteRequestBody): string | undefined {
  return (
    asOptionalString(body.thread_identifier) ||
    asOptionalString(body.threadId) ||
    asOptionalString(body.emailThreadId) ||
    asOptionalString(body.conversationId)
  );
}

function textLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

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
    const session = await getServerSession().catch(() => null);
    const requestBody = (await req.json()) as PlanRouteRequestBody;
    const { emailText, docText, command } = requestBody;
    const threadIdentifier = extractThreadIdentifier(requestBody);
    const offline = getOfflineRuntimeConfig();
    const requestId =
      req.headers.get("x-request-id") ||
      req.headers.get("x-vercel-id") ||
      undefined;
    const baseTraceMetadata: AegisRespanMetadataInput = {
      service: "aegis-desk",
      surface: "plan",
      endpoint: "/api/plan",
      workflow_type: "plan",
      tool_name: "planner",
      search_provider: "none",
      fallback_triggered: false,
      offline_mode: offline.state,
      customer_identifier: session?.id,
      thread_identifier: threadIdentifier,
      request_id: requestId,
    };
    const plannerTelemetryMetadata = toRespanAssociationProperties(
      buildAegisRespanMetadata({
        ...baseTraceMetadata,
        selected_model: PLANNER_MODEL,
      })
    );

    return await withAegisWorkflowSpan(
      {
        name: "plan.request",
        version: PLAN_TRACE_VERSION,
        metadata: baseTraceMetadata,
      },
      async () => {
        const offlineResponse = await withAegisTaskSpan(
          {
            name: "plan.offline_guard",
            version: PLAN_TRACE_VERSION,
            metadata: baseTraceMetadata,
          },
          async () => {
            if (!isOfflineEnforced(offline)) return null;

            addAegisSpanEvent("plan.offline_blocked", {
              offline_mode: offline.state,
            });

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
        );

        if (offlineResponse) {
          return offlineResponse;
        }

        const normalizedInput = await withAegisTaskSpan(
          {
            name: "plan.input_normalization",
            version: PLAN_TRACE_VERSION,
            metadata: baseTraceMetadata,
          },
          async () => {
            const fixedMeetingISO = tomorrowAt3pmNYISO();

            addAegisSpanEvent("plan.inputs_normalized", {
              email_chars: textLength(emailText),
              doc_chars: textLength(docText),
              command_chars: textLength(command),
              has_thread_identifier: Boolean(threadIdentifier),
            });

            return {
              emailText,
              docText,
              command,
              fixedMeetingISO,
            };
          }
        );

        const plannerPrompt = await withAegisTaskSpan(
          {
            name: "plan.prompt_construction",
            version: PLAN_TRACE_VERSION,
            metadata: {
              ...baseTraceMetadata,
              selected_model: PLANNER_MODEL,
            },
          },
          async () => `
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
- Set datetimeISO EXACTLY to: ${normalizedInput.fixedMeetingISO}

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
${normalizedInput.emailText}

DOC:
${normalizedInput.docText}

COMMAND:
${normalizedInput.command}
`);

        const result = await withAegisTaskSpan(
          {
            name: "plan.llm_planner_call",
            version: PLAN_TRACE_VERSION,
            metadata: {
              ...baseTraceMetadata,
              selected_model: PLANNER_MODEL,
              fallback_triggered: false,
            },
          },
          async () => {
            const plannerResult = await generateText({
              model: openai(PLANNER_MODEL),
              prompt: plannerPrompt,
              experimental_telemetry: {
                isEnabled: isRespanEnabled(),
                functionId: "plan.llm_planner_call",
                // Keep planner traces metadata-first until prompt review is complete.
                recordInputs: false,
                recordOutputs: false,
                metadata: plannerTelemetryMetadata,
              },
            });

            addAegisSpanEvent("plan.llm_call_completed", {
              response_chars: plannerResult.text.length,
            });

            return plannerResult;
          }
        );

        annotateAegisCurrentSpan({
          ...baseTraceMetadata,
          selected_model: PLANNER_MODEL,
          fallback_triggered: false,
        });

        const parsedPlan = await withAegisTaskSpan(
          {
            name: "plan.schema_validation",
            version: PLAN_TRACE_VERSION,
            metadata: {
              ...baseTraceMetadata,
              selected_model: PLANNER_MODEL,
            },
          },
          async () => {
            try {
              // Robust JSON extraction handles accidental surrounding text.
              const start = result.text.indexOf("{");
              const end = result.text.lastIndexOf("}");
              if (start === -1 || end === -1 || end <= start) {
                throw new Error("Planner did not return valid JSON object.");
              }

              const jsonText = result.text.slice(start, end + 1);
              const parsed = PlannerPlanSchema.parse(JSON.parse(jsonText));

              addAegisSpanEvent("plan.schema_validated", {
                parse_success: true,
                step_count: parsed.steps.length,
              });

              annotateAegisCurrentSpan({
                ...baseTraceMetadata,
                selected_model: PLANNER_MODEL,
                parse_success: true,
                schema_validation_result: "passed",
                fallback_triggered: false,
              });

              return parsed;
            } catch (error) {
              addAegisSpanEvent("plan.schema_validated", {
                parse_success: false,
                fallback_triggered: false,
              });

              annotateAegisCurrentSpan({
                ...baseTraceMetadata,
                selected_model: PLANNER_MODEL,
                parse_success: false,
                schema_validation_result: "failed",
                fallback_triggered: false,
              });

              throw error;
            }
          }
        );

        annotateAegisCurrentSpan({
          ...baseTraceMetadata,
          selected_model: PLANNER_MODEL,
          parse_success: true,
          schema_validation_result: "passed",
          fallback_triggered: false,
        });

        const responsePayload = await withAegisTaskSpan(
          {
            name: "plan.response_assembly",
            version: PLAN_TRACE_VERSION,
            metadata: {
              ...baseTraceMetadata,
              selected_model: PLANNER_MODEL,
              parse_success: true,
              schema_validation_result: "passed",
              fallback_triggered: false,
            },
          },
          async () => {
            const plan = normalizePlan({
              plan: parsedPlan,
              emailText: normalizedInput.emailText,
              docText: normalizedInput.docText,
              command: normalizedInput.command,
              fixedMeetingISO: normalizedInput.fixedMeetingISO,
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
              icsStep.datetimeISO = normalizedInput.fixedMeetingISO;
            }

            addAegisSpanEvent("plan.response_ready", {
              step_count: plan.steps.length,
              search_step_count: searchSteps.length,
            });

            return { ok: true as const, plan };
          }
        );

        return Response.json(responsePayload);
      }
    );
  } catch (err: unknown) {
    console.error("Plan error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Plan failed", detail },
      { status: 500 }
    );
  }
}
