"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import type {
  QueueDecision,
  QueueDecisionAction,
  QueueEventType,
  QueueLedgerEntry,
  QueueScoreResponse,
  QueueSignalSnapshot,
  QueueVerifyResponse,
  StepUpChallenge,
} from "@/lib/queueguard/types";

type Persona = "normal_fan" | "suspicious_user" | "bot_burst";

type ApiError = {
  ok: false;
  error: string;
  detail?: unknown;
};

const ACTION_LABELS: Record<QueueEventType, string> = {
  join_queue: "Join Queue",
  checkout: "Checkout",
  refresh: "Refresh",
};

const PERSONA_LABELS: Record<Persona, string> = {
  normal_fan: "Normal Fan",
  suspicious_user: "Suspicious User",
  bot_burst: "Bot Burst",
};

function makeSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `qg_${Date.now().toString(36)}_${rand}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function badgeClass(action: QueueDecisionAction) {
  if (action === "ALLOW") return "text-emerald-200 border-emerald-300/40 bg-emerald-500/10";
  if (action === "STEP_UP") return "text-cyan-100 border-cyan-300/40 bg-cyan-500/10";
  if (action === "THROTTLE") return "text-amber-100 border-amber-300/40 bg-amber-500/10";
  return "text-rose-100 border-rose-300/40 bg-rose-500/10";
}

function formatTime(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleTimeString([], { hour12: false });
}

function buildSnapshot(args: {
  persona: Persona;
  eventType: QueueEventType;
  actionCount: number;
  intervalMs: number;
  sequence: QueueEventType[];
}): QueueSignalSnapshot {
  const { persona, eventType, actionCount, intervalMs, sequence } = args;
  const sequenceFingerprint = sequence.slice(-6).join(">");
  if (persona === "normal_fan") {
    return {
      clientTs: Date.now(),
      timingIntervalMs: Math.max(intervalMs, 350 + (actionCount % 5) * 120),
      payloadHash: `${eventType}_${Date.now()}_${actionCount}`,
      sequenceFingerprint,
      multiTabBurst: false,
      tokenReuse: false,
      uaFlip: false,
    };
  }

  if (persona === "suspicious_user") {
    return {
      clientTs: Date.now(),
      timingIntervalMs: Math.max(120, 280 + (actionCount % 2) * 30),
      payloadHash: `${eventType}_sus_${Math.floor(actionCount / 2)}`,
      sequenceFingerprint: sequenceFingerprint || `${eventType}>refresh`,
      multiTabBurst: eventType === "refresh" && actionCount % 2 === 0,
      tokenReuse: actionCount % 3 === 0,
      uaFlip: actionCount % 4 === 0,
    };
  }

  return {
    clientTs: Date.now(),
    timingIntervalMs: 110,
    payloadHash: `bot_${eventType}_replay`,
    sequenceFingerprint: `${eventType}>refresh>refresh>checkout`,
    multiTabBurst: true,
    tokenReuse: true,
    uaFlip: actionCount % 2 === 0,
  };
}

async function parseJson<T>(res: Response): Promise<T | ApiError> {
  const parsed = (await res.json()) as T | ApiError;
  return parsed;
}

export function QueueGuardDashboard() {
  const [sessionId] = useState(() => makeSessionId());
  const [persona, setPersona] = useState<Persona>("normal_fan");
  const [decision, setDecision] = useState<QueueDecision | null>(null);
  const [challenge, setChallenge] = useState<StepUpChallenge | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [requestBusy, setRequestBusy] = useState(false);
  const [statusNote, setStatusNote] = useState("Choose a persona and simulate queue actions.");
  const [ledger, setLedger] = useState<QueueLedgerEntry[]>([]);
  const [ledgerFilter, setLedgerFilter] = useState<"ALL" | QueueDecisionAction>("ALL");
  const [otpInput, setOtpInput] = useState("");
  const [holdStartedAt, setHoldStartedAt] = useState<number | null>(null);
  const [holdTargetMs, setHoldTargetMs] = useState(2000);
  const [holdProgress, setHoldProgress] = useState(0);

  const simulatorRef = useRef({
    actionCount: 0,
    lastEventAt: 0,
    sequence: [] as QueueEventType[],
  });
  const holdEndingRef = useRef(false);

  const refreshLedger = useCallback(async () => {
    const actionQuery = ledgerFilter === "ALL" ? "" : `&action=${ledgerFilter}`;
    const res = await fetch(`/api/queueguard/ledger?limit=120${actionQuery}`, { cache: "no-store" });
    const parsed = await parseJson<{ ok: true; ledger: QueueLedgerEntry[] }>(res);
    if (!res.ok || !parsed || !("ok" in parsed) || !parsed.ok) {
      return;
    }
    setLedger(parsed.ledger || []);
  }, [ledgerFilter]);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  useEffect(() => {
    if (!holdStartedAt) {
      setHoldProgress(0);
      return;
    }
    const id = window.setInterval(() => {
      const elapsed = Date.now() - holdStartedAt;
      setHoldProgress(clamp(elapsed / holdTargetMs, 0, 1));
    }, 40);
    return () => window.clearInterval(id);
  }, [holdStartedAt, holdTargetMs]);

  const sendScoreRequest = useCallback(
    async (eventType: QueueEventType) => {
      const now = Date.now();
      const interval = simulatorRef.current.lastEventAt > 0 ? now - simulatorRef.current.lastEventAt : 1200;
      simulatorRef.current.lastEventAt = now;
      simulatorRef.current.actionCount += 1;
      simulatorRef.current.sequence.push(eventType);
      if (simulatorRef.current.sequence.length > 20) {
        simulatorRef.current.sequence = simulatorRef.current.sequence.slice(-20);
      }

      const snapshot = buildSnapshot({
        persona,
        eventType,
        actionCount: simulatorRef.current.actionCount,
        intervalMs: interval,
        sequence: simulatorRef.current.sequence,
      });

      const res = await fetch("/api/queueguard/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          eventType,
          signalsSnapshot: snapshot,
        }),
      });

      const parsed = await parseJson<QueueScoreResponse>(res);
      if (!res.ok || !parsed || !("ok" in parsed) || !parsed.ok) {
        const message = "error" in (parsed || {}) ? (parsed as ApiError).error : "Queue scoring failed.";
        setStatusNote(message);
        return { challenged: false };
      }

      setDecision(parsed.decision);
      setChallenge(parsed.challenge);
      setLatencyMs(parsed.latencyMs);
      if (parsed.challenge) {
        setModalOpen(true);
        setStatusNote(`Step-up required at level ${parsed.challenge.level}.`);
      } else {
        setStatusNote(`${ACTION_LABELS[eventType]} evaluated as ${parsed.decision.action}.`);
      }
      await refreshLedger();
      return { challenged: Boolean(parsed.challenge) };
    },
    [persona, refreshLedger, sessionId]
  );

  const runAction = useCallback(
    async (eventType: QueueEventType) => {
      if (requestBusy) return;
      setRequestBusy(true);
      try {
        if (persona !== "bot_burst") {
          await sendScoreRequest(eventType);
          return;
        }

        for (let i = 0; i < 6; i += 1) {
          const result = await sendScoreRequest(eventType);
          if (result.challenged) break;
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
      } finally {
        setRequestBusy(false);
      }
    },
    [persona, requestBusy, sendScoreRequest]
  );

  const verifyChallenge = useCallback(
    async (payload: { method: "hold" | "otp"; holdDurationMs?: number; otp?: string }) => {
      if (!challenge) return;
      setRequestBusy(true);
      try {
        const res = await fetch("/api/queueguard/stepup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            challengeId: challenge.challengeId,
            ...payload,
          }),
        });
        const parsed = await parseJson<QueueVerifyResponse>(res);
        if (!res.ok || !parsed || !("ok" in parsed) || !parsed.ok) {
          const message = "error" in (parsed || {}) ? (parsed as ApiError).error : "Step-up verification failed.";
          setStatusNote(message);
          return;
        }
        setDecision(parsed.decision);
        setLatencyMs(parsed.latencyMs);
        setChallenge(parsed.challenge);
        setStatusNote(parsed.reason);
        if (parsed.verified) {
          setModalOpen(false);
          setChallenge(undefined);
          setOtpInput("");
        } else if (parsed.challenge) {
          setModalOpen(true);
        }
        await refreshLedger();
      } finally {
        setRequestBusy(false);
      }
    },
    [challenge, refreshLedger, sessionId]
  );

  const startHold = useCallback(
    (targetMs: number) => {
      if (requestBusy) return;
      holdEndingRef.current = false;
      setHoldTargetMs(targetMs);
      setHoldStartedAt(Date.now());
    },
    [requestBusy]
  );

  const endHold = useCallback(async () => {
    if (!holdStartedAt || holdEndingRef.current) return;
    holdEndingRef.current = true;
    const heldMs = Date.now() - holdStartedAt;
    setHoldStartedAt(null);
    await verifyChallenge({ method: "hold", holdDurationMs: heldMs });
  }, [holdStartedAt, verifyChallenge]);

  const riskBarWidth = decision ? `${decision.risk}%` : "0%";
  const topFactorsText = useMemo(() => {
    if (!decision || decision.topFactors.length === 0) return "No factors yet";
    return decision.topFactors.map((factor) => `${factor.label} (${factor.contribution.toFixed(1)})`).join(" • ");
  }, [decision]);

  const exportLedger = useCallback(() => {
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `queueguard-ledger-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [ledger]);

  return (
    <div className="grid min-h-0 gap-4">
      <section className="rounded-3xl border border-foreground/8 bg-surface/90 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest opacity-40">QueueGuard Dashboard</div>
            <h1 className="mt-3 text-2xl font-medium tracking-tight md:text-3xl">Risk-based queue verification</h1>
            <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
              Accessibility-first challenge flow for queue actions, with live scoring, step-up verification, and an auditable ledger.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">Session {sessionId.slice(-6)}</StatusBadge>
            <StatusBadge tone={requestBusy ? "caution" : "clear"}>{requestBusy ? "Processing" : "Ready"}</StatusBadge>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Queue Depth" value={ledger.length} sub="Ledger entries" />
        <MetricCard label="Risk Score" value={decision ? decision.risk : "--"} sub="Latest score response" tone={decision && decision.risk >= 75 ? "risk" : decision && decision.risk >= 40 ? "caution" : "clear"} />
        <MetricCard label="Latency" value={latencyMs ? `${latencyMs}ms` : "--"} sub="Most recent API round-trip" tone="info" />
        <MetricCard label="Step-up" value={challenge ? `L${challenge.level}` : "None"} sub="Current challenge state" tone={challenge ? "caution" : "clear"} />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <section className="flex min-h-0 flex-col rounded-2xl border border-foreground/8 bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground/6 pb-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium tracking-tight text-foreground">Simulator</h2>
              <p className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
                Select a persona, then trigger queue actions.
              </p>
            </div>
            <div className="font-mono text-xs text-foreground/50">Latency: {latencyMs}ms</div>
          </div>

          <div className="mt-4 grid min-h-0 gap-4">
            <div className="grid gap-2">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Persona</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(PERSONA_LABELS) as Persona[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPersona(key)}
                    className={[
                      "rounded-full border px-3 py-2 text-sm transition-all duration-200 ease-out",
                      persona === key
                        ? "border-accent bg-accent text-background"
                        : "border-foreground/8 bg-background/70 text-foreground/60 hover:-translate-y-0.5 hover:border-foreground/15 hover:text-foreground",
                    ].join(" ")}
                  >
                    {PERSONA_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Actions</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(ACTION_LABELS) as QueueEventType[]).map((eventType) => (
                  <button
                    key={eventType}
                    type="button"
                    onClick={() => void runAction(eventType)}
                    disabled={requestBusy}
                    className="rounded-full bg-accent px-3 py-2 text-sm font-medium text-background transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {ACTION_LABELS[eventType]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Quick view</div>
              <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-foreground/60">Decision</span>
                  <span className={`rounded-full border px-2 py-1 text-xs font-medium ${decision ? badgeClass(decision.action) : "border-foreground/8 bg-surface text-foreground/50"}`}>
                    {decision?.action || "IDLE"}
                  </span>
                  <span className="text-xs text-foreground/60">Step-up L{decision?.stepUpLevel ?? 0}</span>
                </div>
                <div className="mt-3 text-xs text-foreground/60">
                  Risk: <span className="font-medium text-foreground">{decision?.risk ?? 0}</span>/100
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-400 transition-[width] duration-300 ease-out" style={{ width: riskBarWidth }} />
                </div>
                <div className="mt-3 text-xs text-foreground/60">Top factors: {topFactorsText}</div>
                <div className="mt-2 text-xs text-foreground/60">
                  Friction budget:{" "}
                  {decision
                    ? `${decision.frictionBudget.used}/${decision.frictionBudget.cap} used (${decision.frictionBudget.remaining} remaining)`
                    : "0/100 used"}
                </div>
                <div className="mt-2 font-mono text-xs text-foreground/50">Policy: {decision?.policyVersion || "queueguard-policy-v1"}</div>
              </div>
            </div>

            <div className="text-xs font-light text-foreground/60">{statusNote}</div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-2xl border border-foreground/8 bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground/6 pb-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium tracking-tight text-foreground">Trust Ledger</h2>
              <p className="mt-1 text-sm font-light leading-relaxed text-foreground/60">Append-only operational log with hash chain metadata.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={ledgerFilter}
                onChange={(e) => setLedgerFilter(e.target.value as "ALL" | QueueDecisionAction)}
                className="w-full min-w-0 rounded-full border border-foreground/8 bg-background/70 px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 sm:w-28"
                aria-label="Filter ledger by decision action"
              >
                <option value="ALL">All</option>
                <option value="ALLOW">ALLOW</option>
                <option value="STEP_UP">STEP_UP</option>
                <option value="THROTTLE">THROTTLE</option>
                <option value="BLOCK">BLOCK</option>
              </select>
              <button
                type="button"
                onClick={exportLedger}
                className="rounded-full border border-foreground/8 bg-background/70 px-3 py-2 text-xs font-medium text-foreground/60 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:text-foreground"
              >
                Export JSON
              </button>
            </div>
          </div>

          <div className="mt-4 flex-1 min-h-0 space-y-2 overflow-y-auto">
            {ledger.slice(0, 80).map((entry, i) => (
              <div
                key={entry.id}
                style={{ transitionDelay: `${i * 30}ms` }}
                className="rounded-2xl border border-foreground/8 bg-background/70 p-3 text-xs transition-all duration-200 ease-out"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-foreground/60">{formatTime(entry.ts)}</span>
                  <span className={`rounded-full border px-2 py-0.5 ${badgeClass(entry.decisionAction)}`}>{entry.decisionAction}</span>
                </div>
                <div className="mt-1 text-foreground/60">
                  event={entry.eventType} · risk={entry.risk} · stepUp=L{entry.stepUpLevel} · outcome={entry.stepUpOutcome}
                </div>
                <div className="mt-1 text-foreground/50">
                  factors={entry.topFactorKeys.join(", ")} · latency={entry.latencyMs}ms
                </div>
                <div className="mt-1 break-all font-mono text-foreground/50">
                  prev={entry.prevHash.slice(0, 16)}... hash={entry.entryHash.slice(0, 16)}...
                </div>
              </div>
            ))}
            {ledger.length === 0 ? <div className="text-xs text-foreground/50">No ledger events yet.</div> : null}
          </div>
        </section>
      </div>

      {modalOpen && challenge ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="queueguard-stepup-title"
            className="w-full max-w-lg space-y-3 rounded-3xl border border-foreground/8 bg-surface p-5 shadow-2xl"
          >
            <div className="border-b border-foreground/6 pb-3">
              <div id="queueguard-stepup-title" className="text-sm font-medium tracking-tight text-foreground">
                Step-Up Verification (Level {challenge.level})
              </div>
              <div className="mt-1 text-xs font-light text-foreground/60">
                Accessibility-first challenge. No image CAPTCHA. Keyboard-only flow supported.
              </div>
            </div>

            {challenge.level === 1 ? (
              <div className="space-y-3">
                <div className="text-xs text-foreground/60">Hold confirm for 2 seconds. Release to submit verification.</div>
                <button
                  type="button"
                  onMouseDown={() => startHold(2000)}
                  onMouseUp={() => void endHold()}
                  onMouseLeave={() => void endHold()}
                  onTouchStart={() => startHold(2000)}
                  onTouchEnd={() => void endHold()}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      if (!e.repeat) startHold(2000);
                      e.preventDefault();
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      void endHold();
                    }
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-background transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90"
                >
                  Hold to Confirm
                </button>
                <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-75 ease-linear" style={{ width: `${Math.round(holdProgress * 100)}%` }} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-foreground/60">Enter OTP or use hold fallback (3 seconds) for accessibility.</div>
                <div className="rounded-2xl border border-foreground/8 bg-background/70 p-3 text-xs text-foreground">
                  Demo OTP: <span className="font-mono text-cyan-300">{challenge.otpForDemo || "------"}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="Enter OTP"
                    className="w-full rounded-full border border-foreground/8 bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/50"
                    inputMode="numeric"
                    aria-label="One time passcode"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyChallenge({ method: "otp", otp: otpInput.trim() })}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-3 py-2 text-sm font-medium text-background transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                    disabled={!otpInput.trim()}
                  >
                    Verify OTP
                  </button>
                </div>
                <button
                  type="button"
                  onMouseDown={() => startHold(3000)}
                  onMouseUp={() => void endHold()}
                  onMouseLeave={() => void endHold()}
                  onTouchStart={() => startHold(3000)}
                  onTouchEnd={() => void endHold()}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      if (!e.repeat) startHold(3000);
                      e.preventDefault();
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      void endHold();
                    }
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-foreground/8 bg-background/70 px-4 py-2.5 text-sm font-medium text-foreground/60 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:text-foreground"
                >
                  Hold Fallback (3s)
                </button>
                <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-cyan-400 transition-[width] duration-75 ease-linear" style={{ width: `${Math.round(holdProgress * 100)}%` }} />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setStatusNote("Step-up canceled by user.");
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground/8 bg-background/70 px-3 py-2 text-sm font-medium text-foreground/60 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
