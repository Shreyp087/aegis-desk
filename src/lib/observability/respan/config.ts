import "server-only";

import type { InstrumentationName, RespanOptions } from "@respan/tracing";

import { AEGIS_RESPAN_SERVICE } from "./types";

const DEFAULT_RESPAN_BASE_URL = "https://api.respan.ai";

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  return fallback;
}

function normalizeApiKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_RESPAN_BASE_URL;
}

export interface RespanConfig {
  enabled: boolean;
  configured: boolean;
  apiKey?: string;
  baseUrl: string;
  environment: string;
  gatewayEnabled: boolean;
  serviceName: string;
}

// We keep the tracing client manual-only for now so foundation code does not
// silently instrument providers or network paths before routes opt in.
export const RESPAN_DISABLED_AUTO_INSTRUMENTATIONS = [
  "http",
  "openAI",
  "anthropic",
  "azureOpenAI",
  "cohere",
  "bedrock",
  "googleVertexAI",
  "googleAIPlatform",
  "pinecone",
  "together",
  "langChain",
  "llamaIndex",
  "chromaDB",
  "qdrant",
] as const satisfies readonly InstrumentationName[];

export function getRespanConfig(env: NodeJS.ProcessEnv = process.env): RespanConfig {
  const apiKey = normalizeApiKey(env.RESPAN_API_KEY);
  const enabled = parseBooleanEnv(env.RESPAN_ENABLED, false);

  return {
    enabled,
    configured: Boolean(apiKey),
    apiKey,
    baseUrl: normalizeBaseUrl(env.RESPAN_BASE_URL),
    environment: (env.RESPAN_ENVIRONMENT || env.NODE_ENV || "development").trim(),
    gatewayEnabled: parseBooleanEnv(env.RESPAN_GATEWAY_ENABLED, false),
    serviceName: AEGIS_RESPAN_SERVICE,
  };
}

export function isRespanEnabled(config: RespanConfig = getRespanConfig()): boolean {
  return config.enabled && config.configured;
}

export function isRespanGatewayEnabled(config: RespanConfig = getRespanConfig()): boolean {
  return isRespanEnabled(config) && config.gatewayEnabled;
}

export function getRespanTracingOptions(
  env: NodeJS.ProcessEnv = process.env
): RespanOptions | null {
  const config = getRespanConfig(env);
  if (!isRespanEnabled(config) || !config.apiKey) return null;

  return {
    appName: config.serviceName,
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    tracingEnabled: true,
    traceContent: false,
    logLevel: "error",
    silenceInitializationMessage: true,
    disabledInstrumentations: [...RESPAN_DISABLED_AUTO_INSTRUMENTATIONS],
    resourceAttributes: {
      environment: config.environment,
    },
  };
}
