// import { openai } from "@ai-sdk/openai";
// import { generateText, streamText, tool } from "ai";
// import { z } from "zod";

// import { PlanSchema, AgentFinalSchema } from "@/lib/agent/schemas";
// import { PLANNER_SYSTEM, PLANNER_USER, EXECUTOR_SYSTEM, CRITIC_SYSTEM } from "@/lib/agent/prompts";
// import { privacyFirewall } from "@/lib/tools/privacy";
// import { linkupSearch } from "@/lib/tools/linkup";
// import { createICS } from "@/lib/tools/ics";

// export async function POST(req: Request) {
//   const { emailText, docText, command } = await req.json();

//   // 1) PLAN (non-streaming, strict JSON)
//   const planRes = await generateText({
//     model: openai("gpt-4o-mini"),
//     system: PLANNER_SYSTEM,
//     prompt: PLANNER_USER(emailText ?? "", docText ?? "", command ?? ""),
//   });

//   let planJson: any;
//   try {
//     planJson = JSON.parse(planRes.text);
//     PlanSchema.parse(planJson);
//   } catch (e) {
//     return Response.json({ error: "Planner failed to produce valid plan JSON.", raw: planRes.text }, { status: 400 });
//   }

//   // 2) EXECUTE (streaming + tools)
//   return streamText({
//     model: openai("gpt-4o-mini"),
//     system: `${EXECUTOR_SYSTEM}

// Here is the PLAN JSON you must execute:
// ${JSON.stringify(planJson, null, 2)}
// `,
//     messages: [
//       {
//         role: "user",
//         content: `Execute the plan. Produce intermediate artifacts and ledger events.`,
//       },
//     ],
//     tools: {
//       privacyFirewall: tool({
//         description: "Redacts sensitive data before web search",
//         parameters: z.object({ rawQuery: z.string() }),
//         execute: async ({ rawQuery }) => privacyFirewall(rawQuery),
//       }),

//       linkupSearch: tool({
//         description: "Searches the web using Linkup (requires safe query)",
//         parameters: z.object({ safeQuery: z.string(), reason: z.string() }),
//         execute: async ({ safeQuery, reason }) => {
//           const { results } = await linkupSearch(safeQuery);
//           return { reason, results };
//         },
//       }),

//       createICS: tool({
//         description: "Creates a calendar invite (.ics) from title + datetimeISO",
//         parameters: z.object({ title: z.string(), datetimeISO: z.string() }),
//         execute: async ({ title, datetimeISO }) => createICS(title, datetimeISO),
//       }),
//     },
//   });
// }

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";

export async function POST(req: Request) {
  try {
    const offline = getOfflineRuntimeConfig();
    if (isOfflineEnforced(offline)) {
      return Response.json(
        {
          error: "Offline mode enforced",
          detail:
            "Agent endpoint is disabled in enforced offline mode because it relies on remote model calls.",
          offlineState: offline.state,
        },
        { status: 503 }
      );
    }

    const { emailText, docText, command } = await req.json();

    console.log("Agent request received");

    const result = await generateText({
      model: openai("gpt-4o-mini"),
      system: `
You are an autonomous desktop intelligence agent.
Summarize, verify claims conceptually, and draft a reply.
Do NOT use tools yet.
`,
      prompt: `
EMAIL:
${emailText}

DOCUMENT:
${docText}

COMMAND:
${command}
`,
    });

    return Response.json({
      ok: true,
      output: result.text,
    });
  } catch (err: any) {
    console.error("Agent error:", err);
    return Response.json(
      { error: "Agent failed", detail: err?.message },
      { status: 500 }
    );
  }
}
