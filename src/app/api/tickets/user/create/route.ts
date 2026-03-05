import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint",
      detail: "Use POST /api/tickets/create (authenticated user) instead.",
    },
    { status: 410 }
  );
}
