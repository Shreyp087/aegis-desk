const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_TOKEN_COOKIE = "aegis_gmail_token";
export const GMAIL_OAUTH_STATE_COOKIE = "aegis_gmail_oauth_state";

type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
};

export type CookieStore = {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
};

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GmailTokenBundle = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  tokenType: string;
  scope: string;
  emailAddress?: string;
};

export function buildPublicRequestUrl(req: Request): URL {
  const direct = new URL(req.url);
  const forwardedHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    direct.host;
  const forwardedProto =
    req.headers.get("x-forwarded-proto") ||
    direct.protocol.replace(/:$/, "") ||
    "https";

  return new URL(`${forwardedProto}://${forwardedHost}${direct.pathname}${direct.search}`);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  );
}

function resolveRedirectUri(requestUrl?: URL): string | undefined {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  const requestBased = requestUrl ? `${requestUrl.origin}/api/inbox/gmail/callback` : undefined;

  if (!configured) {
    return requestBased;
  }

  try {
    const configuredUrl = new URL(configured);
    const requestHost = requestUrl?.hostname ? requestUrl.hostname.toLowerCase() : "";
    const requestIsPublic = Boolean(requestHost) && !isLoopbackHost(requestHost);
    const configuredIsLoopback = isLoopbackHost(configuredUrl.hostname);

    if (requestIsPublic && configuredIsLoopback) {
      return requestBased;
    }

    return configuredUrl.toString();
  } catch {
    return requestBased || configured;
  }
}

type GmailTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GmailListResponse = {
  messages?: Array<{ id: string }>;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: {
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};

type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailPart;
};

type GmailProfile = {
  emailAddress: string;
};

function buildCookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function encodeToken(bundle: GmailTokenBundle): string {
  return Buffer.from(JSON.stringify(bundle), "utf8").toString("base64url");
}

function decodeToken(encoded: string): GmailTokenBundle | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.accessToken !== "string") return null;
    if (typeof parsed.expiresAt !== "number") return null;
    if (typeof parsed.tokenType !== "string") return null;
    if (typeof parsed.scope !== "string") return null;

    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
      expiresAt: parsed.expiresAt,
      tokenType: parsed.tokenType,
      scope: parsed.scope,
      emailAddress: typeof parsed.emailAddress === "string" ? parsed.emailAddress : undefined,
    };
  } catch {
    return null;
  }
}

export function getGmailOAuthConfig(requestUrl?: URL): GmailOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveRedirectUri(requestUrl);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Gmail OAuth config. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and configure a valid deployed Gmail callback URI."
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function createOauthState(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function setGmailOauthStateCookie(store: CookieStore, state: string): void {
  store.set(GMAIL_OAUTH_STATE_COOKIE, state, buildCookieOptions(10 * 60));
}

export function readGmailOauthStateCookie(store: CookieStore): string | null {
  return store.get(GMAIL_OAUTH_STATE_COOKIE)?.value ?? null;
}

export function clearGmailOauthStateCookie(store: CookieStore): void {
  store.delete(GMAIL_OAUTH_STATE_COOKIE);
}

export function setGmailTokenCookie(store: CookieStore, token: GmailTokenBundle): void {
  store.set(GMAIL_TOKEN_COOKIE, encodeToken(token), buildCookieOptions(30 * 24 * 60 * 60));
}

export function readGmailTokenCookie(store: CookieStore): GmailTokenBundle | null {
  const value = store.get(GMAIL_TOKEN_COOKIE)?.value;
  if (!value) return null;
  return decodeToken(value);
}

export function clearGmailTokenCookie(store: CookieStore): void {
  store.delete(GMAIL_TOKEN_COOKIE);
}

export function buildGmailAuthUrl(config: GmailOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function exchangeToken(params: URLSearchParams): Promise<GmailTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await parseErrorBody(res);
    throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as Partial<GmailTokenResponse>;
  if (!json.access_token || !json.expires_in) {
    throw new Error("Google token response is missing access token fields.");
  }

  return {
    access_token: json.access_token,
    expires_in: json.expires_in,
    refresh_token: json.refresh_token,
    scope: json.scope,
    token_type: json.token_type,
  };
}

export async function exchangeCodeForToken(args: {
  code: string;
  config: GmailOAuthConfig;
}): Promise<GmailTokenBundle> {
  const token = await exchangeToken(
    new URLSearchParams({
      code: args.code,
      client_id: args.config.clientId,
      client_secret: args.config.clientSecret,
      redirect_uri: args.config.redirectUri,
      grant_type: "authorization_code",
    })
  );

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    expiresAt: Date.now() + token.expires_in * 1000,
    tokenType: token.token_type || "Bearer",
    scope: token.scope || GMAIL_SCOPE,
  };
}

export async function refreshAccessToken(args: {
  refreshToken: string;
  config: GmailOAuthConfig;
}): Promise<Pick<GmailTokenBundle, "accessToken" | "expiresAt" | "tokenType" | "scope">> {
  const token = await exchangeToken(
    new URLSearchParams({
      refresh_token: args.refreshToken,
      client_id: args.config.clientId,
      client_secret: args.config.clientSecret,
      grant_type: "refresh_token",
    })
  );

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    tokenType: token.token_type || "Bearer",
    scope: token.scope || GMAIL_SCOPE,
  };
}

async function gmailGetJson<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await parseErrorBody(res);
    throw new Error(`Gmail API request failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectBodyText(part?: GmailPart): { plain: string[]; html: string[] } {
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (node?: GmailPart) => {
    if (!node) return;
    const data = node.body?.data;
    const mimeType = (node.mimeType || "").toLowerCase();
    if (data) {
      const decoded = decodeBase64Url(data).trim();
      if (decoded) {
        if (mimeType.includes("text/plain")) plain.push(decoded);
        else if (mimeType.includes("text/html")) html.push(decoded);
      }
    }

    for (const child of node.parts || []) walk(child);
  };

  walk(part);
  return { plain, html };
}

function collectAttachmentNames(part?: GmailPart): string[] {
  const out = new Set<string>();
  const walk = (node?: GmailPart) => {
    if (!node) return;
    const name = (node.filename || "").trim();
    if (name) out.add(name);
    for (const child of node.parts || []) walk(child);
  };
  walk(part);
  return Array.from(out).slice(0, 12);
}

function headerValue(headers: GmailHeader[] | undefined, headerName: string): string {
  const match = (headers || []).find((h) => h.name.toLowerCase() === headerName.toLowerCase());
  return (match?.value || "").trim();
}

function toRawEmail(message: GmailMessage): string {
  const headers = message.payload?.headers;
  const from = headerValue(headers, "From") || "(Unknown sender)";
  const to = headerValue(headers, "To");
  const subject = headerValue(headers, "Subject") || "(No subject)";
  const date = headerValue(headers, "Date");
  const threadId = (message.threadId || "").trim();
  const body = collectBodyText(message.payload);
  const attachments = collectAttachmentNames(message.payload);
  const plainBody = body.plain.join("\n\n").trim();
  const htmlFallback = stripHtml(body.html.join("\n\n"));
  const finalBody = plainBody || htmlFallback || (message.snippet || "").trim() || "(No body)";

  return [
    `From: ${from}`,
    to ? `To: ${to}` : "",
    `Subject: ${subject}`,
    date ? `Date: ${date}` : "",
    threadId ? `Thread-Id: ${threadId}` : "",
    attachments.length ? `Attachments: ${attachments.join(", ")}` : "",
    "",
    "Body:",
    finalBody,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  return gmailGetJson<GmailProfile>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile"
  );
}

export async function fetchLatestGmailRawEmails(args: {
  accessToken: string;
  maxResults?: number;
  query?: string;
}): Promise<string[]> {
  const maxResults = Math.max(1, Math.min(50, args.maxResults ?? 20));
  const query = (args.query || "in:inbox").trim();

  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("q", query);

  const list = await gmailGetJson<GmailListResponse>(args.accessToken, listUrl.toString());
  const ids = list.messages || [];
  if (!ids.length) return [];

  const details = await Promise.all(
    ids.map((m) =>
      gmailGetJson<GmailMessage>(
        args.accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`
      )
    )
  );

  return details.map(toRawEmail).filter(Boolean);
}

export async function getValidGmailToken(
  store: CookieStore,
  requestUrl?: URL
): Promise<GmailTokenBundle | null> {
  const existing = readGmailTokenCookie(store);
  if (!existing) return null;

  const safeWindowMs = 60 * 1000;
  if (existing.expiresAt > Date.now() + safeWindowMs) {
    return existing;
  }

  if (!existing.refreshToken) {
    clearGmailTokenCookie(store);
    return null;
  }

  try {
    const config = getGmailOAuthConfig(requestUrl);
    const refreshed = await refreshAccessToken({
      refreshToken: existing.refreshToken,
      config,
    });
    const next: GmailTokenBundle = {
      ...existing,
      ...refreshed,
    };
    setGmailTokenCookie(store, next);
    return next;
  } catch {
    clearGmailTokenCookie(store);
    return null;
  }
}
