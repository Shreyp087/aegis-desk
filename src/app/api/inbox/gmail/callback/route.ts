import { cookies } from "next/headers";

import {
  clearGmailOauthStateCookie,
  exchangeCodeForToken,
  getGmailOAuthConfig,
  getGmailProfile,
  readGmailOauthStateCookie,
  setGmailTokenCookie,
} from "@/lib/inbox/gmail";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appUrl = new URL("/", url.origin);

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    appUrl.searchParams.set("gmail_error", oauthError);
    return Response.redirect(appUrl, 302);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = readGmailOauthStateCookie(cookieStore);
  clearGmailOauthStateCookie(cookieStore);

  if (!code || !state || !expectedState || state !== expectedState) {
    appUrl.searchParams.set("gmail_error", "invalid_oauth_state");
    return Response.redirect(appUrl, 302);
  }

  try {
    const config = getGmailOAuthConfig(url);
    const token = await exchangeCodeForToken({ code, config });

    let emailAddress: string | undefined;
    try {
      const profile = await getGmailProfile(token.accessToken);
      emailAddress = profile.emailAddress;
    } catch {
      emailAddress = undefined;
    }

    setGmailTokenCookie(cookieStore, {
      ...token,
      emailAddress,
    });

    appUrl.searchParams.set("gmail", "connected");
    return Response.redirect(appUrl, 302);
  } catch {
    appUrl.searchParams.set("gmail_error", "token_exchange_failed");
    return Response.redirect(appUrl, 302);
  }
}
