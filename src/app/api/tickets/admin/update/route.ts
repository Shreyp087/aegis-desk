import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint",
      detail: "Use PATCH /api/tickets/:id/assign, /respond, or /resolve instead.",
    },
    { status: 410 }
  );
}
