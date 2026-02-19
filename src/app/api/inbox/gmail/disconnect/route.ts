import { cookies } from "next/headers";

import { clearGmailOauthStateCookie, clearGmailTokenCookie } from "@/lib/inbox/gmail";

export async function POST() {
  const cookieStore = await cookies();
  clearGmailTokenCookie(cookieStore);
  clearGmailOauthStateCookie(cookieStore);
  return Response.json({ ok: true });
}
