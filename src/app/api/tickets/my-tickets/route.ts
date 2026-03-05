import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";
import type { TicketDto } from "@/lib/ticketing/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    await connectMongo();
    const tickets = await TicketModel.find({ createdBy: auth.user.id })
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
    return NextResponse.json({ ok: false, error: "Ticket list failed", detail }, { status: 500 });
  }
}
