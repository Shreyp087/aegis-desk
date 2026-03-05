import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  return NextResponse.json(
    {
      ok: true,
      profile: {
        id: auth.session.id,
        name: auth.session.name,
        email: auth.session.email,
        role: auth.session.role,
      },
    },
    { status: 200 }
  );
}
