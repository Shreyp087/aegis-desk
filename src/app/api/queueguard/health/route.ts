import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, module: "queueguard", ts: Date.now() });
}
