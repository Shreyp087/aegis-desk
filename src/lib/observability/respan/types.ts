import "server-only";

import type { OfflineModeState } from "@/lib/offline/template";

export const AEGIS_RESPAN_SERVICE = "aegis-desk";

export type AegisRespanSurface =
  | "plan"
  | "run"
  | "inbox"
  | "agent"
  | "auth"
  | "system"
  | "unknown";

export type AegisRespanWorkflowType =
  | "plan"
  | "run"
  | "inbox"
  | "agent"
  | "planning"
  | "research"
  | "inbox_scan"
  | "agent_response"
  | "auth"
  | "system"
  | "unknown";

export type AegisRespanRiskCategory =
  | "safe"
  | "promotion"
  | "spam"
  | "harmful"
  | "contract"
  | "financial"
  | "identity"
  | "unknown";

export type AegisRespanUncertaintyBand = "low" | "medium" | "high" | "unknown";

export type AegisRespanSearchProvider =
  | "linkup"
  | "gmail"
  | "local"
  | "manual"
  | "none"
  | "unknown";

export interface AegisRespanMetadata {
  service: string;
  surface: AegisRespanSurface;
  endpoint: string;
  workflow_type: AegisRespanWorkflowType;
  risk_category?: AegisRespanRiskCategory;
  risk_score?: number;
  trusted_decision?: boolean;
  uncertainty_band?: AegisRespanUncertaintyBand;
  fallback_triggered?: boolean;
  cache_hit?: boolean;
  tool_name?: string;
  search_provider?: AegisRespanSearchProvider;
  evidence_count?: number;
  offline_mode: OfflineModeState;
  selected_model?: string;
  parse_success?: boolean;
  schema_validation_result?: "passed" | "failed";
  customer_identifier?: string;
  thread_identifier?: string;
  group_identifier?: string;
  custom_identifier?: string;
  request_id?: string;
}

export type AegisRespanMetadataInput = Partial<AegisRespanMetadata>;

export interface AegisRespanSpanOptions {
  name: string;
  version?: number;
  metadata?: AegisRespanMetadataInput;
}
