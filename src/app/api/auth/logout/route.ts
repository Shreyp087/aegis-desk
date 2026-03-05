import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  return clearAuthCookie(response);
}
