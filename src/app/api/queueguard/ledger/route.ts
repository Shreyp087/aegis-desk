import { NextResponse } from "next/server";
import { getLedger } from "@/lib/queueguard/store";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set(["ALLOW", "STEP_UP", "THROTTLE", "BLOCK"]);

function parseLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 150;
  return Math.max(1, Math.min(Math.round(parsed), 500));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const actionRaw = url.searchParams.get("action");
    const action = actionRaw ? actionRaw.trim().toUpperCase() : undefined;
    if (action && !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        { ok: false, error: "Invalid action filter. Use ALLOW, STEP_UP, THROTTLE, or BLOCK." },
        { status: 400 }
      );
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    const ledger = getLedger({ action, limit });
    return NextResponse.json({ ok: true, ledger, count: ledger.length }, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Ledger fetch failed", detail }, { status: 500 });
  }
}
