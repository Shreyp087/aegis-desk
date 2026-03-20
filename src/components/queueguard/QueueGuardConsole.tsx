"use client";

import { useEffect, useMemo, useState } from "react";

import { MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import { appendLedger, readLedger } from "@/lib/queueguard/ledger";
import { policyForMode } from "@/lib/queueguard/policy";
import { applyStepUpResult, evaluateAttempt, initSessionState, recordEvent } from "@/lib/queueguard/riskEngine";
import type { LedgerEntry, PolicyMode, QueueAction, RiskDecision, SessionState } from "@/lib/queueguard/types";

import LedgerPanel from "./LedgerPanel";
import QueueSimulatorPanel from "./QueueSimulatorPanel";
import RiskPanel from "./RiskPanel";
import StepUpModal from "./StepUpModal";

export default function QueueGuardConsole() {
  const [state, setState] = useState<SessionState>(() => initSessionState());
  const [decision, setDecision] = useState<RiskDecision | null>(null);
  const [pendingAction, setPendingAction] = useState<QueueAction | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLedger(readLedger());
  }, []);

  const policy = useMemo(() => policyForMode(state.mode), [state.mode]);

  async function logOutcome(
    actionAttempted: QueueAction,
    d: RiskDecision,
    outcome: LedgerEntry["outcome"],
    snapshot?: SessionState
  ) {
    const source = snapshot ?? state;
    const top = d.factors.slice(0, 3).map((f) => ({ key: f.key, points: Math.round(f.points) }));

    const entry: LedgerEntry = {
      ts: Date.now(),
      sessionId: source.sessionId,
      actionAttempted,
      decisionAction: d.action,
      risk: d.risk,
      stepUpLevel: d.stepUpLevel,
      stepUpMethod: d.stepUpMethod,
      topFactors: top,
      frictionUsed: source.frictionUsed,
      frictionCap: policy.frictionCap,
      policyVersion: policy.policyVersion,
      mode: source.mode,
      outcome,
    };

    await appendLedger(entry);
    setLedger(readLedger());
  }

  async function attempt(action: QueueAction, meta?: unknown) {
    setBusy(true);
    try {
      const s1 = recordEvent(
        state,
        action,
        meta as { multiTab?: boolean; tokenReuse?: boolean; uaFlip?: boolean } | undefined
      );
      setState(s1);

      const d = evaluateAttempt(s1, action);
      d.friction = {
        cap: policy.frictionCap,
        used: s1.frictionUsed,
        remaining: Math.max(0, policy.frictionCap - s1.frictionUsed),
      };
      setDecision(d);

      if (d.action === "ALLOW") {
        await logOutcome(action, d, "ALLOWED", s1);
        setPendingAction(null);
        setStepUpOpen(false);
        return;
      }
      if (d.action === "THROTTLE") {
        await logOutcome(action, d, "THROTTLED", s1);
        setPendingAction(null);
        setStepUpOpen(false);
        return;
      }
      if (d.action === "BLOCK") {
        await logOutcome(action, d, "BLOCKED", s1);
        setPendingAction(null);
        setStepUpOpen(false);
        return;
      }

      setPendingAction(action);
      setStepUpOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function onStepUpResult(passed: boolean) {
    if (!decision || !pendingAction) {
      setStepUpOpen(false);
      return;
    }

    const s2 = applyStepUpResult(state, decision.stepUpLevel, passed);
    setState(s2);

    if (passed) {
      await logOutcome(pendingAction, decision, "CHALLENGE_PASSED", s2);
    } else {
      await logOutcome(pendingAction, decision, "CHALLENGE_FAILED", s2);
    }

    setStepUpOpen(false);
    setPendingAction(null);
  }

  function resetSession() {
    setState(initSessionState({ mode: state.mode }));
    setDecision(null);
    setPendingAction(null);
    setStepUpOpen(false);
  }

  return (
    <div id="queueguard-console" className="flex min-h-0 flex-1 flex-col gap-5">
      <section className="rounded-3xl border border-foreground/8 bg-surface/90 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest opacity-40">QueueGuard Console</div>
            <h1 className="mt-3 text-2xl font-medium tracking-tight md:text-3xl">Risk-based queue verification</h1>
            <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
              Monitor live queue behavior, inspect derived risk signals, and review the operational ledger without leaving the console.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Session {state.sessionId.slice(-6)}</StatusBadge>
            <StatusBadge tone={busy ? "caution" : "clear"}>{busy ? "Working" : "Idle"}</StatusBadge>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Queue Depth" value={state.events.length} sub="Observed session events" />
        <MetricCard label="Processing Rate" value={busy ? "Active" : "Idle"} sub="Current simulator state" tone={busy ? "caution" : "clear"} />
        <MetricCard label="Risk Score" value={decision ? decision.risk : "--"} sub="Latest evaluated action" tone={decision && decision.risk >= 75 ? "risk" : decision && decision.risk >= 40 ? "caution" : "clear"} />
        <MetricCard label="Blocked Items" value={ledger.filter((entry) => entry.outcome === "BLOCKED").length} sub="Ledger outcomes" tone="risk" />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)_minmax(0,0.9fr)]">
        <QueueSimulatorPanel
          state={state}
          decision={decision}
          busy={busy}
          onAttempt={attempt}
          onReset={resetSession}
          onModeChange={(m: PolicyMode) => setState((s) => ({ ...s, mode: m }))}
        />
        <RiskPanel state={state} decision={decision} policyVersion={policy.policyVersion} />
        <LedgerPanel ledger={ledger} onRefresh={() => setLedger(readLedger())} />
      </div>

      {stepUpOpen ? <StepUpModal open={stepUpOpen} decision={decision} onClose={() => setStepUpOpen(false)} onResult={onStepUpResult} /> : null}
    </div>
  );
}
