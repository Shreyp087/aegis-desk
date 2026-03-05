import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint",
      detail: "Use GET /api/tickets/my-tickets (authenticated user) instead.",
    },
    { status: 410 }
  );
}
