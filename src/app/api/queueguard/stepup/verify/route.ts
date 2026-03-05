import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStepUpChallenge } from "@/lib/queueguard/engine";
import { appendLedgerEvent, ensureSession, getSession } from "@/lib/queueguard/store";
import type { QueueEventType, QueueVerifyInput, QueueVerifyResponse } from "@/lib/queueguard/types";

export const runtime = "nodejs";

const VerifyBodySchema = z.object({
  sessionId: z.string().min(8).max(128),
  challengeId: z.string().min(8).max(128),
  method: z.enum(["hold", "otp"]),
  holdDurationMs: z.number().int().nonnegative().optional(),
  otp: z.string().trim().min(4).max(10).optional(),
});

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const parsed = VerifyBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid request payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data as QueueVerifyInput;
    const session = ensureSession(input.sessionId);
    const result = verifyStepUpChallenge({ session, input });
    const latencyMs = Date.now() - startedAt;

    const eventType: QueueEventType =
      session.lastEventType || getSession(input.sessionId)?.lastEventType || "refresh";

    appendLedgerEvent({
      sessionId: input.sessionId,
      eventKind: "verify",
      eventType,
      attemptedAction: eventType,
      decision: result.decision,
      stepUpOutcome: result.verified ? "pass" : "fail",
      latencyMs,
    });

    const response: QueueVerifyResponse = {
      ok: true,
      sessionId: input.sessionId,
      verified: result.verified,
      decision: result.decision,
      challenge: result.challenge,
      reason: result.reason,
      latencyMs,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Step-up verification failed", detail }, { status: 500 });
  }
}
