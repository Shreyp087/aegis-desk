import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint",
      detail: "Ticket actions are now visible through authenticated ticket APIs.",
    },
    { status: 410 }
  );
}
