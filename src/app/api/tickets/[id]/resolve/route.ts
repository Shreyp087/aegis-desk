import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { requireAdmin } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";

export const runtime = "nodejs";

export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;

    const { id } = await ctx.params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid ticket id" }, { status: 400 });
    }

    await connectMongo();
    const ticket = await TicketModel.findById(id);
    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    if (!ticket.assignedAdmin) ticket.assignedAdmin = auth.admin.id;
    ticket.status = "resolved";
    ticket.resolvedAt = new Date();
    ticket.updatedAt = new Date();
    await ticket.save();

    const updated = await TicketModel.findById(id)
      .populate("createdBy", "name email")
      .populate("assignedAdmin", "name email")
      .lean();
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Ticket not found after update" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ticket: toTicketDto(updated) }, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Resolve failed", detail }, { status: 500 });
  }
}
