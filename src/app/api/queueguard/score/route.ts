import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateQueueAction } from "@/lib/queueguard/engine";
import { appendLedgerEvent, ensureSession, saveSession } from "@/lib/queueguard/store";
import type { QueueEventType, QueueScoreResponse, QueueSignalSnapshot } from "@/lib/queueguard/types";

export const runtime = "nodejs";

const SignalSnapshotSchema = z.object({
  clientTs: z.number().int().optional(),
  timingIntervalMs: z.number().int().nonnegative().optional(),
  payloadHash: z.string().min(3).max(256).optional(),
  sequenceFingerprint: z.string().min(1).max(256).optional(),
  multiTabBurst: z.boolean().optional(),
  tokenReuse: z.boolean().optional(),
  uaFlip: z.boolean().optional(),
});

const ScoreBodySchema = z.object({
  sessionId: z.string().min(8).max(128),
  eventType: z.enum(["join_queue", "checkout", "refresh"]),
  signalsSnapshot: SignalSnapshotSchema.default({}),
});

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const parsed = ScoreBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid request payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, eventType, signalsSnapshot } = parsed.data as {
      sessionId: string;
      eventType: QueueEventType;
      signalsSnapshot: QueueSignalSnapshot;
    };
    const session = await ensureSession(sessionId);
    const { decision, challenge } = evaluateQueueAction({
      session,
      eventType,
      snapshot: signalsSnapshot,
    });
    const latencyMs = Date.now() - startedAt;

    await saveSession(session);
    await appendLedgerEvent({
      sessionId,
      eventKind: "score",
      eventType,
      attemptedAction: eventType,
      decision,
      stepUpOutcome: challenge ? "issued" : "none",
      latencyMs,
    });

    const response: QueueScoreResponse = {
      ok: true,
      sessionId,
      eventType,
      decision,
      challenge,
      latencyMs,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Queue score failed", detail }, { status: 500 });
  }
}
