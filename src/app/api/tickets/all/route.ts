import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";
import type { TicketDto } from "@/lib/ticketing/types";

export const runtime = "nodejs";

const StatusSchema = z.enum(["open", "in_progress", "resolved"]);

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;

    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("status");
    const statusParsed = rawStatus ? StatusSchema.safeParse(rawStatus) : null;
    if (rawStatus && !statusParsed?.success) {
      return NextResponse.json({ ok: false, error: "Invalid status filter" }, { status: 400 });
    }

    const query = statusParsed?.success ? { status: statusParsed.data } : {};

    await connectMongo();
    const tickets = await TicketModel.find(query)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email")
      .populate("assignedAdmin", "name email")
      .lean();

    const serialized: TicketDto[] = tickets.map((ticket: Parameters<typeof toTicketDto>[0]) =>
      toTicketDto(ticket)
    );
    return NextResponse.json({ ok: true, tickets: serialized }, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Admin ticket list failed", detail }, { status: 500 });
  }
}
