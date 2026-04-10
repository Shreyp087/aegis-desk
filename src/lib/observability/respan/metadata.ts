import "server-only";

import { getOfflineRuntimeConfig } from "@/lib/offline/runtime";

import { getRespanConfig } from "./config";
import {
  AEGIS_RESPAN_SERVICE,
  type AegisRespanMetadata,
  type AegisRespanMetadataInput,
} from "./types";

type RespanAssociationProperties = Record<string, string>;

type RespanSpanParams = {
  custom_identifier?: string;
  customer_identifier?: string;
  thread_identifier?: string;
  group_identifier?: string;
  environment?: string;
  metadata?: Record<string, string | number | boolean>;
};

function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function normalizeFiniteNumber(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.isFinite(value) ? value : undefined;
}

export function mergeAegisRespanMetadata(
  ...parts: Array<AegisRespanMetadataInput | undefined>
): AegisRespanMetadataInput {
  return parts.reduce<AegisRespanMetadataInput>((merged, part) => {
    if (!part) return merged;
    return {
      ...merged,
      ...compactObject(part),
    };
  }, {});
}

export function buildAegisRespanMetadata(
  input: AegisRespanMetadataInput = {}
): AegisRespanMetadata {
  const offlineRuntime = getOfflineRuntimeConfig();

  return {
    service: input.service || AEGIS_RESPAN_SERVICE,
    surface: input.surface || "unknown",
    endpoint: input.endpoint || "unknown",
    workflow_type: input.workflow_type || "unknown",
    risk_category: input.risk_category,
    risk_score: normalizeFiniteNumber(input.risk_score),
    trusted_decision: input.trusted_decision,
    uncertainty_band: input.uncertainty_band,
    fallback_triggered: input.fallback_triggered,
    cache_hit: input.cache_hit,
    tool_name: input.tool_name,
    search_provider: input.search_provider,
    evidence_count: normalizeFiniteNumber(input.evidence_count),
    offline_mode: input.offline_mode || offlineRuntime.state,
    selected_model: input.selected_model,
    parse_success: input.parse_success,
    schema_validation_result: input.schema_validation_result,
    customer_identifier: input.customer_identifier,
    thread_identifier: input.thread_identifier,
    group_identifier: input.group_identifier,
    custom_identifier: input.custom_identifier,
    request_id: input.request_id,
  };
}

export function toRespanAssociationProperties(
  metadata: AegisRespanMetadataInput = {}
): RespanAssociationProperties {
  return Object.entries(compactObject(metadata)).reduce<RespanAssociationProperties>(
    (attributes, [key, value]) => {
      if (value === undefined) return attributes;
      attributes[key] = String(value);
      return attributes;
    },
    {}
  );
}

export function toRespanSpanParams(
  metadata: AegisRespanMetadataInput = {}
): RespanSpanParams {
  const {
    customer_identifier,
    thread_identifier,
    group_identifier,
    custom_identifier,
    ...rest
  } = compactObject(metadata);

  const config = getRespanConfig();
  const spanMetadata = compactObject(rest) as Record<string, string | number | boolean>;

  return compactObject({
    customer_identifier:
      typeof customer_identifier === "string" ? customer_identifier : undefined,
    thread_identifier: typeof thread_identifier === "string" ? thread_identifier : undefined,
    group_identifier: typeof group_identifier === "string" ? group_identifier : undefined,
    custom_identifier: typeof custom_identifier === "string" ? custom_identifier : undefined,
    environment: config.environment,
    metadata: Object.keys(spanMetadata).length > 0 ? spanMetadata : undefined,
  });
}
