import { z } from "zod";

function normalizeRespanApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "https://api.respan.ai/v1";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

export const RESPAN_BASE_URL = normalizeRespanApiBaseUrl(process.env.RESPAN_BASE_URL);
export const RESPAN_API_KEY = process.env.RESPAN_API_KEY;

if (!RESPAN_API_KEY) {
  console.warn("RESPAN_API_KEY not set - Respan prompts disabled");
}

const RespanPromptRequestSchema = z.object({
  prompt_id: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
});

const RespanPromptResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.enum(["assistant"]),
        content: z.string(),
      }),
      finish_reason: z.string(),
    })
  ),
});

export type PromptVariables = Record<string, unknown>;

export async function callRespanPrompt({
  promptId,
  variables = {},
  model,
}: {
  promptId: string;
  variables?: PromptVariables;
  model?: string;
}): Promise<string> {
  if (!RESPAN_API_KEY) {
    throw new Error("RESPAN_API_KEY not set");
  }

  const body = RespanPromptRequestSchema.parse({
    prompt_id: promptId,
    variables,
    model,
  });

  const response = await fetch(`${RESPAN_BASE_URL}/prompts/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESPAN_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Respan prompt failed: ${response.status} ${text}`);
  }

  const data = RespanPromptResponseSchema.parse(await response.json());
  return data.choices[0].message.content;
}

export const RESPAN_PROMPTS_ENABLED = process.env.RESPAN_PROMPTS_ENABLED === "1";

export const RESPAN_PROMPT_ID_PLAN = process.env.RESPAN_PROMPT_ID_PLAN;
export const RESPAN_PROMPT_ID_SYNTHESIS = process.env.RESPAN_PROMPT_ID_SYNTHESIS || process.env.RESPAN_PROMPT_ID_REPLY_DRAFT;

