export const INBOX_ADMIN_SETTINGS_COOKIE = "aegis_inbox_admin_settings";
export const INBOX_ADMIN_SETTINGS_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type InboxConsensusPolicySource = "env_default" | "admin_override";

export type InboxConsensusPolicy = {
  enabled: boolean;
  maxModels: number;
  source: InboxConsensusPolicySource;
};

export type InboxAdminSettings = {
  consensusEnabled: boolean;
  consensusMaxModels: number;
  updatedAt: string;
  updatedBy: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

export function normalizeConsensusMaxModels(value: number): number {
  return clamp(Math.round(value), 1, 8);
}

export function buildEnvConsensusPolicy(
  env: NodeJS.ProcessEnv = process.env
): InboxConsensusPolicy {
  const enabled = parseBooleanEnv(env.INBOX_CONSENSUS_ENABLED, false);
  const maxModels = normalizeConsensusMaxModels(parseIntEnv(env.INBOX_CONSENSUS_MAX_MODELS, 3));

  return {
    enabled,
    maxModels,
    source: "env_default",
  };
}

export function parseInboxAdminSettingsCookie(
  cookieValue?: string
): InboxAdminSettings | null {
  if (!cookieValue) return null;
  try {
    const raw = JSON.parse(
      Buffer.from(cookieValue, "base64url").toString("utf8")
    ) as Partial<InboxAdminSettings>;

    if (typeof raw.consensusEnabled !== "boolean") return null;
    if (typeof raw.consensusMaxModels !== "number") return null;
    if (typeof raw.updatedAt !== "string") return null;
    if (typeof raw.updatedBy !== "string") return null;

    return {
      consensusEnabled: raw.consensusEnabled,
      consensusMaxModels: normalizeConsensusMaxModels(raw.consensusMaxModels),
      updatedAt: raw.updatedAt,
      updatedBy: raw.updatedBy,
    };
  } catch {
    return null;
  }
}

export function encodeInboxAdminSettingsCookie(
  settings: InboxAdminSettings
): string {
  return Buffer.from(JSON.stringify(settings), "utf8").toString("base64url");
}

export function resolveConsensusPolicy(args: {
  envPolicy: InboxConsensusPolicy;
  adminSettings: InboxAdminSettings | null;
}): InboxConsensusPolicy {
  if (!args.adminSettings) return args.envPolicy;
  return {
    enabled: args.adminSettings.consensusEnabled,
    maxModels: normalizeConsensusMaxModels(args.adminSettings.consensusMaxModels),
    source: "admin_override",
  };
}

