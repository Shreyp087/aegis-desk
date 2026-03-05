"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [sessionId, setSessionId] = useState(() => makeSessionId());
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

  const resetSession = useCallback(() => {
    setSessionId(makeSessionId());
    setDecision(null);
    setChallenge(undefined);
    setModalOpen(false);
    setLatencyMs(0);
    setStatusNote("Started a fresh ephemeral session.");
    simulatorRef.current = { actionCount: 0, lastEventAt: 0, sequence: [] };
  }, []);

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
    return decision.topFactors
      .map((factor) => `${factor.label} (${factor.contribution.toFixed(1)})`)
      .join(" • ");
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
    <div className="grid gap-3 min-h-0">
      <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-100">Aegis QueueGuard Simulator</div>
          <div className="text-xs text-slate-300">
            Session <span className="panel-mono">{sessionId}</span> (ephemeral, no raw PII stored)
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetSession}
            className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold"
          >
            New Session
          </button>
          {challenge ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold"
            >
              Resume Step-Up
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-3 min-h-0">
        <section className="glass-panel p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-slate-100">Queue Simulator</div>
              <div className="text-xs text-slate-300">Select persona, then trigger queue actions.</div>
            </div>
            <div className="text-xs text-slate-400">Latency: {latencyMs}ms</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(Object.keys(PERSONA_LABELS) as Persona[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPersona(key)}
                className={`px-3 py-2 rounded-lg text-sm border ${
                  persona === key
                    ? "border-cyan-300/70 bg-cyan-500/20 text-cyan-100"
                    : "border-[rgba(118,157,199,0.33)] bg-[rgba(11,20,34,0.5)] text-slate-200"
                }`}
              >
                {PERSONA_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(Object.keys(ACTION_LABELS) as QueueEventType[]).map((eventType) => (
              <button
                key={eventType}
                type="button"
                onClick={() => void runAction(eventType)}
                disabled={requestBusy}
                className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {ACTION_LABELS[eventType]}
              </button>
            ))}
          </div>

          <div className="surface-subcard p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-300">Decision</span>
              <span
                className={`text-xs px-2 py-1 rounded-full border font-semibold ${
                  decision ? badgeClass(decision.action) : "text-slate-200 border-slate-500/30 bg-slate-700/20"
                }`}
              >
                {decision?.action || "IDLE"}
              </span>
              <span className="text-xs text-slate-300">Step-up L{decision?.stepUpLevel ?? 0}</span>
            </div>
            <div className="text-xs text-slate-300">
              Risk: <b>{decision?.risk ?? 0}</b>/100
            </div>
            <div className="h-2 rounded-full bg-slate-900/70 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-300 via-amber-300 to-rose-300"
                style={{ width: riskBarWidth }}
              />
            </div>
            <div className="text-xs text-slate-300">Top factors: {topFactorsText}</div>
            <div className="text-xs text-slate-300">
              Friction budget:{" "}
              {decision
                ? `${decision.frictionBudget.used}/${decision.frictionBudget.cap} used (${decision.frictionBudget.remaining} remaining)`
                : "0/100 used"}
            </div>
            <div className="text-xs text-slate-400">Policy: {decision?.policyVersion || "queueguard-policy-v1"}</div>
          </div>

          <div className="text-xs text-slate-300">{statusNote}</div>
        </section>

        <section className="glass-panel p-4 min-h-0 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-slate-100">Trust Ledger</div>
            <div className="flex items-center gap-2">
              <select
                value={ledgerFilter}
                onChange={(e) => setLedgerFilter(e.target.value as "ALL" | QueueDecisionAction)}
                className="field-input !py-1.5 !px-2 !text-xs w-[120px]"
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
                className="secondary-ghost px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Export JSON
              </button>
            </div>
          </div>

          <div className="scroll-surface p-2 max-h-[520px] overflow-auto space-y-2">
            {ledger.slice(0, 80).map((entry) => (
              <div key={entry.id} className="event-card p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-100">{formatTime(entry.ts)}</span>
                  <span className={`px-2 py-0.5 rounded-full border ${badgeClass(entry.decisionAction)}`}>
                    {entry.decisionAction}
                  </span>
                </div>
                <div className="text-slate-300 mt-1">
                  event={entry.eventType} • risk={entry.risk} • stepUp=L{entry.stepUpLevel} • outcome=
                  {entry.stepUpOutcome}
                </div>
                <div className="text-slate-400 mt-1">
                  factors={entry.topFactorKeys.join(", ")} • latency={entry.latencyMs}ms
                </div>
                <div className="text-slate-500 mt-1 panel-mono break-all">
                  prev={entry.prevHash.slice(0, 16)}... hash={entry.entryHash.slice(0, 16)}...
                </div>
              </div>
            ))}
            {ledger.length === 0 ? <div className="text-xs text-slate-400">No ledger events yet.</div> : null}
          </div>
        </section>
      </div>

      {modalOpen && challenge ? (
        <div className="fixed inset-0 z-[120] bg-slate-950/70 flex items-center justify-center p-3">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="queueguard-stepup-title"
            className="surface-card w-full max-w-lg p-4 space-y-3"
          >
            <div>
              <div id="queueguard-stepup-title" className="text-base font-semibold text-slate-100">
                Step-Up Verification (Level {challenge.level})
              </div>
              <div className="text-xs text-slate-300">
                Accessibility-first challenge. No image CAPTCHA. Keyboard-only flow supported.
              </div>
            </div>

            {challenge.level === 1 ? (
              <div className="space-y-3">
                <div className="text-xs text-slate-300">
                  Hold confirm for 2 seconds. Release to submit verification.
                </div>
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
                  className="w-full primary-cta px-4 py-3 rounded-lg text-sm font-semibold"
                >
                  Hold to Confirm
                </button>
                <div className="h-2 rounded-full bg-slate-900/70 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                    style={{ width: `${Math.round(holdProgress * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-slate-300">
                  Enter OTP or use hold fallback (3 seconds) for accessibility.
                </div>
                <div className="surface-subcard p-3 text-xs text-slate-200">
                  Demo OTP: <span className="panel-mono text-cyan-200">{challenge.otpForDemo || "------"}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="Enter OTP"
                    className="field-input !py-2 !px-3"
                    inputMode="numeric"
                    aria-label="One time passcode"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyChallenge({ method: "otp", otp: otpInput.trim() })}
                    className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap"
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
                  className="w-full secondary-ghost px-4 py-2.5 rounded-lg text-sm font-semibold"
                >
                  Hold Fallback (3s)
                </button>
                <div className="h-2 rounded-full bg-slate-900/70 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-300 to-cyan-300"
                    style={{ width: `${Math.round(holdProgress * 100)}%` }}
                  />
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
                className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold"
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
