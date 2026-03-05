import { NextResponse } from "next/server";
import { z } from "zod";

import { connectMongo } from "@/lib/db/mongoose";
import { InboxMailClassEnum } from "@/lib/inbox/schemas";
import { IncidentMemoryModel } from "@/lib/models/IncidentMemory";

export const runtime = "nodejs";

const InboxFeedbackSchema = z.object({
  sourceHash: z.string().min(8).max(128),
  sourceEmailId: z.string().min(1).max(140).optional(),
  outcomeLabel: z.enum([
    "spam_true_positive",
    "spam_false_positive",
    "harmful_true_positive",
    "harmful_false_positive",
    "actionable_correct",
    "informational_correct",
  ]),
  correctedClass: InboxMailClassEnum.optional(),
  correctedPriority: z.enum(["low", "medium", "high"]).optional(),
  feedbackSource: z.string().min(2).max(60).optional(),
});

function priorityScoreFromLevel(
  value: "low" | "medium" | "high" | undefined
): number | null {
  if (!value) return null;
  if (value === "high") return 85;
  if (value === "medium") return 60;
  return 25;
}

export async function POST(req: Request) {
  try {
    if (!process.env.MONGODB_URI) {
      return NextResponse.json(
        {
          ok: false,
          error: "Inbox feedback learning is disabled",
          detail: "Set MONGODB_URI to store and learn from inbox feedback.",
        },
        { status: 503 }
      );
    }

    const parsed = InboxFeedbackSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid inbox feedback payload",
          detail: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    await connectMongo();

    const score = priorityScoreFromLevel(parsed.data.correctedPriority);
    const update: Record<string, unknown> = {
      outcomeLabel: parsed.data.outcomeLabel,
      feedbackSource: parsed.data.feedbackSource || "inbox_user_feedback",
    };

    if (parsed.data.correctedClass) {
      update.mailClass = parsed.data.correctedClass;
      if (
        parsed.data.correctedClass === "spam" ||
        parsed.data.correctedClass === "informational"
      ) {
        update.threatType = "none";
      }
    }
    if (score !== null) {
      update.priorityScore = score;
    }

    const result = await IncidentMemoryModel.updateMany(
      { sourceHash: parsed.data.sourceHash },
      { $set: update }
    ).exec();

    return NextResponse.json(
      {
        ok: true,
        matched: result.matchedCount || 0,
        modified: result.modifiedCount || 0,
      },
      { status: 200 }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: "Inbox feedback update failed", detail },
      { status: 500 }
    );
  }
}
