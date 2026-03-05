import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { requireAuth } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if ("response" in auth) return auth.response;

    const { id } = await ctx.params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid ticket id" }, { status: 400 });
    }

    await connectMongo();
    const ticketResult = await TicketModel.findById(id)
      .populate("createdBy", "name email")
      .populate("assignedAdmin", "name email")
      .lean();
    const ticket = Array.isArray(ticketResult) ? ticketResult[0] : ticketResult;
    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    const createdBy = (ticket as { createdBy?: { _id?: { toString(): string } | string } | null }).createdBy ?? null;
    const createdById =
      createdBy && createdBy._id
        ? typeof createdBy._id === "string"
          ? createdBy._id
          : createdBy._id.toString()
        : "";

    if (auth.session.role === "user" && createdById !== auth.session.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ ok: true, ticket: toTicketDto(ticket) }, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Ticket fetch failed", detail }, { status: 500 });
  }
}
