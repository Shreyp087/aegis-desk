import { cookies } from "next/headers";

import {
  buildGmailAuthUrl,
  createOauthState,
  getGmailOAuthConfig,
  setGmailOauthStateCookie,
} from "@/lib/inbox/gmail";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fallbackUrl = new URL("/", url.origin);

  try {
    const config = getGmailOAuthConfig(url);
    const state = createOauthState();
    const cookieStore = await cookies();
    setGmailOauthStateCookie(cookieStore, state);

    const authUrl = buildGmailAuthUrl(config, state);
    return Response.redirect(authUrl, 302);
  } catch {
    fallbackUrl.searchParams.set("gmail_error", "oauth_config_missing");
    return Response.redirect(fallbackUrl, 302);
  }
}
