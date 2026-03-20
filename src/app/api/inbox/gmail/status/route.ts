import { cookies } from "next/headers";

import {
  buildPublicRequestUrl,
  clearGmailTokenCookie,
  getGmailProfile,
  getValidGmailToken,
  setGmailTokenCookie,
} from "@/lib/inbox/gmail";

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = await getValidGmailToken(cookieStore, buildPublicRequestUrl(req));
    if (!token) {
      return Response.json({ connected: false });
    }

    try {
      const profile = await getGmailProfile(token.accessToken);
      if (profile.emailAddress && profile.emailAddress !== token.emailAddress) {
        setGmailTokenCookie(cookieStore, {
          ...token,
          emailAddress: profile.emailAddress,
        });
      }

      return Response.json({
        connected: true,
        email: profile.emailAddress || token.emailAddress || null,
      });
    } catch {
      clearGmailTokenCookie(cookieStore);
      return Response.json({ connected: false });
    }
  } catch {
    return Response.json({ connected: false });
  }
}
