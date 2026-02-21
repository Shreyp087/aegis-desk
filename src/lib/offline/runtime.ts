import { OFFLINE_MODE_TEMPLATE_CONFIG } from "./template";
import type { OfflineModeConfig, OfflineModeState } from "./template";

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseStateEnv(value: string | undefined, fallback: OfflineModeState): OfflineModeState {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "disabled" || normalized === "shadow" || normalized === "enforced") {
    return normalized;
  }
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.round(n));
}

export function getOfflineRuntimeConfig(): OfflineModeConfig {
  const enabled = parseBooleanEnv(process.env.OFFLINE_MODE, OFFLINE_MODE_TEMPLATE_CONFIG.enabled);
  const inferredState: OfflineModeState = enabled ? "enforced" : OFFLINE_MODE_TEMPLATE_CONFIG.state;
  const state = parseStateEnv(process.env.OFFLINE_MODE_STATE, inferredState);

  return {
    ...OFFLINE_MODE_TEMPLATE_CONFIG,
    enabled,
    state,
    blockOutboundNetwork: parseBooleanEnv(
      process.env.OFFLINE_BLOCK_OUTBOUND,
      OFFLINE_MODE_TEMPLATE_CONFIG.blockOutboundNetwork
    ),
    localModelsOnly: parseBooleanEnv(
      process.env.OFFLINE_LOCAL_MODELS_ONLY,
      OFFLINE_MODE_TEMPLATE_CONFIG.localModelsOnly
    ),
    allowExternalResearch: parseBooleanEnv(
      process.env.OFFLINE_ALLOW_EXTERNAL_RESEARCH,
      OFFLINE_MODE_TEMPLATE_CONFIG.allowExternalResearch
    ),
    allowRemoteDrafting: parseBooleanEnv(
      process.env.OFFLINE_ALLOW_REMOTE_DRAFTING,
      OFFLINE_MODE_TEMPLATE_CONFIG.allowRemoteDrafting
    ),
    redactLogsByDefault: parseBooleanEnv(
      process.env.OFFLINE_REDACT_LOGS_BY_DEFAULT,
      OFFLINE_MODE_TEMPLATE_CONFIG.redactLogsByDefault
    ),
    storeRawEmailDays: parsePositiveInt(
      process.env.OFFLINE_STORE_RAW_EMAIL_DAYS,
      OFFLINE_MODE_TEMPLATE_CONFIG.storeRawEmailDays
    ),
    decisionPolicyVersion:
      process.env.OFFLINE_DECISION_POLICY_VERSION || OFFLINE_MODE_TEMPLATE_CONFIG.decisionPolicyVersion,
  };
}

export function isOfflineEnforced(config: OfflineModeConfig = getOfflineRuntimeConfig()): boolean {
  return config.enabled && config.state === "enforced";
}

