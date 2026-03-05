import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint",
      detail: "Ticket sync workflow is replaced by Mongo-backed native tickets.",
    },
    { status: 410 }
  );
}
