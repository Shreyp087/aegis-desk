import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";

export const runtime = "nodejs";

const RespondSchema = z.object({
  adminResponse: z.string().trim().min(1).max(8000),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ("response" in auth) return auth.response;

    const { id } = await ctx.params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid ticket id" }, { status: 400 });
    }

    const parsed = RespondSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid response payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await connectMongo();
    const ticket = await TicketModel.findById(id);
    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    ticket.adminResponse = parsed.data.adminResponse;
    if (!ticket.assignedAdmin) ticket.assignedAdmin = auth.admin.id;
    if (ticket.status === "open") ticket.status = "in_progress";
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
    return NextResponse.json({ ok: false, error: "Respond failed", detail }, { status: 500 });
  }
}
