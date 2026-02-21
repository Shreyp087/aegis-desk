import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
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
- Must include EXACTLY TWO Linkup web research steps.
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
- You MUST output exactly TWO steps of type "redact_and_search".
- Those two searches must be about the TWO most relevant entities to verify (usually companies in the agreement/email).

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
    { "id":"5", "type":"analyze_contract_risks", "desc":"..." },
    { "id":"6", "type":"draft_reply", "desc":"..." },
    { "id":"7", "type":"create_ics", "desc":"...", "title":"...", "datetimeISO":"..." }
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
    const plan = JSON.parse(jsonText);

    // Optional guardrails: ensure exactly two redact_and_search steps
    const searchSteps = (plan.steps || []).filter((s: any) => s.type === "redact_and_search");
    if (searchSteps.length !== 2) {
      throw new Error(`Plan must include exactly 2 redact_and_search steps. Got ${searchSteps.length}.`);
    }

    // Ensure meeting datetimeISO is correct (override if model deviated)
    const icsStep = (plan.steps || []).find((s: any) => s.type === "create_ics");
    if (icsStep) {
      icsStep.datetimeISO = fixedMeetingISO;
    }

    return Response.json({ ok: true, plan });
  } catch (err: any) {
    console.error("Plan error:", err);
    return Response.json(
      { error: "Plan failed", detail: err?.message },
      { status: 500 }
    );
  }
}
