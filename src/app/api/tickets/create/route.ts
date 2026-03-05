import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";
import type { TicketPriority } from "@/lib/ticketing/types";

export const runtime = "nodejs";

const CreateTicketSchema = z.object({
  title: z.string().trim().min(3).max(220),
  description: z.string().trim().min(8).max(8000),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export async function POST(req: Request) {
  try {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const parsed = CreateTicketSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid ticket payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await connectMongo();
    const created = await TicketModel.create({
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority as TicketPriority,
      status: "open",
      createdBy: auth.user.id,
      assignedAdmin: null,
      adminResponse: "",
      resolvedAt: null,
    });

    const hydrated = await TicketModel.findById(created._id)
      .populate("createdBy", "name email")
      .populate("assignedAdmin", "name email")
      .lean();
    if (!hydrated) {
      return NextResponse.json({ ok: false, error: "Ticket creation failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ticket: toTicketDto(hydrated) }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Ticket create failed", detail }, { status: 500 });
  }
}
