"use client";

import { useState } from "react";

import { AegisButton } from "@/components/ui/AegisPrimitives";
import type { PolicyMode, QueueAction, RiskDecision, SessionState } from "@/lib/queueguard/types";
import { runScenario, ScenarioName } from "@/lib/queueguard/scenarios";

export default function QueueSimulatorPanel({
  state,
  decision,
  busy,
  onAttempt,
  onReset,
  onModeChange,
}: {
  state: SessionState;
  decision: RiskDecision | null;
  busy: boolean;
  onAttempt: (action: QueueAction, meta?: unknown) => Promise<void>;
  onReset: () => void;
  onModeChange: (mode: PolicyMode) => void;
}) {
  const [running, setRunning] = useState<ScenarioName | null>(null);

  async function run(name: ScenarioName) {
    setRunning(name);
    try {
      await runScenario(name, async (action, meta) => {
        await onAttempt(action, meta);
      });
    } finally {
      setRunning(null);
    }
  }

  const disabled = busy || running !== null;

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-foreground/8 bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground/6 pb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium tracking-tight text-foreground">Queue Simulator</h2>
          <p className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
            Sandbox actions to show risk-based step-up, throttle, and blocking.
          </p>
        </div>
        <AegisButton variant="ghost" onClick={onReset} disabled={disabled}>
          Reset Session
        </AegisButton>
      </div>

      <div className="mt-4 grid min-h-0 gap-4">
        <div className="grid gap-2">
          <div className="text-xs font-mono uppercase tracking-widest opacity-40">Policy preset</div>
          <select className="aegis-select" value={state.mode} onChange={(e) => onModeChange(e.target.value as PolicyMode)} disabled={disabled}>
            <option value="FAN_FIRST">Fan-first (min friction)</option>
            <option value="STRICT">Strict (aggressive security)</option>
            <option value="ACCESSIBILITY_FIRST">Accessibility-first</option>
          </select>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <AegisButton variant="secondary" onClick={() => onAttempt("JOIN")} disabled={disabled}>
            Join Queue
          </AegisButton>
          <AegisButton variant="secondary" onClick={() => onAttempt("REFRESH")} disabled={disabled}>
            Refresh
          </AegisButton>
          <AegisButton variant="secondary" onClick={() => onAttempt("CHECKOUT")} disabled={disabled}>
            Checkout
          </AegisButton>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-mono uppercase tracking-widest opacity-40">One-click demo scenarios</div>
          <div className="grid gap-2">
            <AegisButton variant="secondary" className="justify-start" onClick={() => run("NORMAL_FAN")} disabled={disabled}>
              Normal Fan Flow
            </AegisButton>
            <AegisButton variant="secondary" className="justify-start" onClick={() => run("SUSPICIOUS_USER")} disabled={disabled}>
              Suspicious User Flow
            </AegisButton>
            <AegisButton variant="secondary" className="justify-start" onClick={() => run("BOT_BURST")} disabled={disabled}>
              Bot Burst Attack
            </AegisButton>
          </div>
        </div>

        <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4 text-sm font-light text-foreground/60">
          <div>
            <span className="font-medium text-foreground">Session:</span> <span className="font-mono">{state.sessionId}</span>
          </div>
          <div className="mt-2">
            <span className="font-medium text-foreground">Joined?</span> {state.joined ? "Yes" : "No"}
          </div>
          <div className="mt-2">
            <span className="font-medium text-foreground">Events:</span> {state.events.length}
          </div>
          {decision ? (
            <div className="mt-4 rounded-2xl border border-foreground/8 bg-surface p-4">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Last decision</div>
              <div className="mt-2 text-sm text-foreground/80">
                Risk <span className="font-medium text-foreground">{decision.risk}/100</span> {"->"}{" "}
                <span className="font-medium text-foreground">{decision.action}</span>
                {decision.action === "STEP_UP" ? ` (L${decision.stepUpLevel})` : ""}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
