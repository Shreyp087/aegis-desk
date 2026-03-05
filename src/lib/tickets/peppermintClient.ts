import type { LocalTicket } from "./types";

export type PeppermintAuthMode = "public" | "login";

export type PeppermintConfig = {
  baseUrl: string;
  authMode: PeppermintAuthMode;
  email?: string;
  password?: string;
};

export type PeppermintCreateResult = {
  peppermintTicketId: string;
  endpointUsed: string;
};

export type PeppermintTicketCreateBody = {
  name: string;
  email?: string;
  title: string;
  priority?: "low" | "medium" | "high";
  type?: string;
  detail: unknown;
};

function assertNetworkAllowed(allowOutboundNetwork: boolean) {
  if (!allowOutboundNetwork) {
    throw new Error("Outbound network disabled by offline enforcement");
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function peppermintFetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Peppermint API error ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function loginAndGetToken(cfg: PeppermintConfig): Promise<string> {
  if (!cfg.email || !cfg.password) {
    throw new Error("Peppermint login mode requires email and password");
  }

  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const out = await peppermintFetchJson<{ token: string }>(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!out?.token) throw new Error("Peppermint login did not return token");
  return out.token;
}

export async function peppermintLogin(
  cfg: PeppermintConfig,
  opts: { allowOutboundNetwork: boolean }
): Promise<string> {
  assertNetworkAllowed(opts.allowOutboundNetwork);
  return await loginAndGetToken(cfg);
}

export async function createPeppermintTicket(
  cfg: PeppermintConfig,
  body: PeppermintTicketCreateBody,
  opts: { allowOutboundNetwork: boolean }
): Promise<PeppermintCreateResult> {
  assertNetworkAllowed(opts.allowOutboundNetwork);
  const baseUrl = normalizeBaseUrl(cfg.baseUrl);

  if (cfg.authMode === "public") {
    const endpoint = "/api/v1/ticket/public/create";
    const res = await peppermintFetchJson<{ success: boolean; id: string }>(`${baseUrl}${endpoint}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res?.id) throw new Error("Peppermint did not return ticket id");
    return { peppermintTicketId: res.id, endpointUsed: endpoint };
  }

  const token = await loginAndGetToken(cfg);
  const endpoint = "/api/v1/ticket/create";
  const res = await peppermintFetchJson<{ success: boolean; id: string }>(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res?.id) throw new Error("Peppermint did not return ticket id");
  return { peppermintTicketId: res.id, endpointUsed: endpoint };
}

export function buildPeppermintTicketBodyFromLocal(
  redacted: Record<string, unknown>,
  ticket: LocalTicket
): PeppermintTicketCreateBody {
  const baseTitle = ticket.subject ? ticket.subject : `Email ${ticket.sourceEmailId}`;
  const title = `[Aegis] ${baseTitle}`;

  const type =
    ticket.decision === "quarantine"
      ? "security"
      : ticket.risk.category.toLowerCase() || "support";

  const priority: "low" | "medium" | "high" =
    ticket.risk.score >= 80 ? "high" : ticket.risk.score >= 50 ? "medium" : "low";

  return {
    name: "Aegis Desk",
    email: typeof ticket.sender === "string" ? ticket.sender : undefined,
    title,
    priority,
    type,
    detail: redacted,
  };
}
