import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { getOfflinePolicy } from "@/lib/tickets/offlinePolicy";
import { getTicketByEmailId, listTickets } from "@/lib/tickets/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth();
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const sourceEmailId = searchParams.get("sourceEmailId");
    const includeAll = searchParams.get("all") === "1";

    if (sourceEmailId) {
      const ticket = await getTicketByEmailId(sourceEmailId);
      return NextResponse.json({ ok: true, ticket }, { status: 200 });
    }

    if (includeAll) {
      if (auth.session.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 });
      }

      const tickets = await listTickets();
      return NextResponse.json(
        {
          ok: true,
          tickets,
          policy: getOfflinePolicy(),
          remoteStatusByLocalTicketId: {},
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Missing query",
        detail: "Provide sourceEmailId for a single lookup or all=1 for the admin ticket list.",
      },
      { status: 400 }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Ticket status lookup failed", detail }, { status: 500 });
  }
}
