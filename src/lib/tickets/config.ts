import type { PeppermintAuthMode, PeppermintConfig } from "./peppermintClient";

export function getPeppermintConfigFromEnv(): PeppermintConfig | null {
  const baseUrl = process.env.PEPPERMINT_BASE_URL;
  if (!baseUrl) return null;

  const authMode = (process.env.PEPPERMINT_AUTH_MODE || "public") as PeppermintAuthMode;
  if (authMode !== "public" && authMode !== "login") {
    throw new Error("PEPPERMINT_AUTH_MODE must be 'public' or 'login'");
  }

  const cfg: PeppermintConfig = {
    baseUrl,
    authMode,
  };

  if (authMode === "login") {
    cfg.email = process.env.PEPPERMINT_EMAIL;
    cfg.password = process.env.PEPPERMINT_PASSWORD;
  }

  return cfg;
}
