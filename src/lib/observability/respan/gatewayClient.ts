/**
 * Respan Gateway Client for selective LLM routing.
 *
 * Paths:
 * - tracing-only: spans.ts (metadata/events)
 * - prompt-managed: promptClient.ts (v2 prompts)
 * - gateway-routed: this file (base_url + api_key proxy)
 */

import { createOpenAI, openai } from "@ai-sdk/openai";

import { parseBooleanEnv } from "./config";

function normalizeRespanGatewayBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

export const RESPAN_GATEWAY_ENABLED = parseBooleanEnv(
  process.env.RESPAN_GATEWAY_ENABLED,
  false
);
export const RESPAN_BASE_URL = normalizeRespanGatewayBaseUrl(process.env.RESPAN_BASE_URL);
export const RESPAN_API_KEY = process.env.RESPAN_API_KEY || "";

let respanGatewayProvider: ReturnType<typeof createOpenAI> | null = null;

function getRespanGatewayProvider() {
  if (!respanGatewayProvider) {
    respanGatewayProvider = createOpenAI({
      baseURL: RESPAN_BASE_URL,
      apiKey: RESPAN_API_KEY,
    });
  }

  return respanGatewayProvider;
}

export function getRespanOpenai(modelId: string) {
  if (!RESPAN_GATEWAY_ENABLED || !RESPAN_BASE_URL || !RESPAN_API_KEY) {
    // Direct provider fallback
    return openai(modelId);
  }

  return getRespanGatewayProvider()(modelId);
}

