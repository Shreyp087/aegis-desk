"use client";

import { useEffect, useMemo, useState } from "react";
import QueueSimulatorPanel from "./QueueSimulatorPanel";
import RiskPanel from "./RiskPanel";
import StepUpModal from "./StepUpModal";
import LedgerPanel from "./LedgerPanel";

import { initSessionState, recordEvent, evaluateAttempt, applyStepUpResult } from "@/lib/queueguard/riskEngine";
import { appendLedger, readLedger } from "@/lib/queueguard/ledger";
import { policyForMode } from "@/lib/queueguard/policy";

import type { QueueAction, SessionState, RiskDecision, LedgerEntry, PolicyMode } from "@/lib/queueguard/types";

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

  async function attempt(action: QueueAction, meta?: any) {
    setBusy(true);
    try {
      const s1 = recordEvent(state, action, meta);
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
    <div className="grid gap-4 md:grid-cols-12">
      <div className="md:col-span-4">
        <QueueSimulatorPanel
          state={state}
          decision={decision}
          busy={busy}
          onAttempt={attempt}
          onReset={resetSession}
          onModeChange={(m: PolicyMode) => setState((s) => ({ ...s, mode: m }))}
        />
      </div>

      <div className="md:col-span-4">
        <RiskPanel state={state} decision={decision} policyVersion={policy.policyVersion} />
      </div>

      <div className="md:col-span-4">
        <LedgerPanel ledger={ledger} onRefresh={() => setLedger(readLedger())} />
      </div>

      <StepUpModal
        open={stepUpOpen}
        decision={decision}
        onClose={() => setStepUpOpen(false)}
        onResult={onStepUpResult}
      />
    </div>
  );
}
