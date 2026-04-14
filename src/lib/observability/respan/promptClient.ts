import { z } from "zod";

import { parseBooleanEnv } from "./config";

function normalizeRespanApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "https://api.respan.ai/api";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

export const RESPAN_BASE_URL = normalizeRespanApiBaseUrl(process.env.RESPAN_BASE_URL);
export const RESPAN_API_KEY = process.env.RESPAN_API_KEY;

if (!RESPAN_API_KEY) {
  console.warn("RESPAN_API_KEY not set - Respan prompts disabled");
}

const RespanPromptRequestSchema = z.object({
  prompt: z.object({
    prompt_id: z.string(),
    schema_version: z.literal(2),
    variables: z.record(z.string(), z.unknown()).optional(),
  }),
});

const RespanPromptResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.union([
          z.string(),
          z.array(
            z.object({
              text: z.string().optional(),
            }).passthrough()
          ),
        ]),
      }).passthrough(),
    })
  ),
});

export type PromptVariables = Record<string, unknown>;

function extractPromptMessageContent(content: z.infer<typeof RespanPromptResponseSchema>["choices"][number]["message"]["content"]): string {
  if (typeof content === "string") return content;

  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export async function callRespanPrompt({
  promptId,
  variables = {},
}: {
  promptId: string;
  variables?: PromptVariables;
}): Promise<string> {
  if (!RESPAN_API_KEY) {
    throw new Error("RESPAN_API_KEY not set");
  }

  const body = RespanPromptRequestSchema.parse({
    prompt: {
      prompt_id: promptId,
      schema_version: 2,
      variables,
    },
  });

  const response = await fetch(`${RESPAN_BASE_URL}/chat/completions`, {
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
  if (data.choices.length === 0) {
    throw new Error("Respan prompt returned no choices");
  }

  return extractPromptMessageContent(data.choices[0].message.content);
}

export const RESPAN_PROMPTS_ENABLED = parseBooleanEnv(
  process.env.RESPAN_PROMPTS_ENABLED,
  false
);

export const RESPAN_PROMPT_ID_PLAN = process.env.RESPAN_PROMPT_ID_PLAN;
export const RESPAN_PROMPT_ID_SYNTHESIS = process.env.RESPAN_PROMPT_ID_SYNTHESIS || process.env.RESPAN_PROMPT_ID_REPLY_DRAFT;

