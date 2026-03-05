"use client";

import { useState } from "react";
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
  onAttempt: (action: QueueAction, meta?: any) => Promise<void>;
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
    <section className="rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Queue Simulator</h2>
          <p className="text-xs opacity-80">Sandbox actions to show risk-based step-up, throttle, and blocking.</p>
        </div>
        <button
          onClick={onReset}
          className="rounded-xl border px-3 py-1 text-xs hover:bg-black/5"
          disabled={disabled}
        >
          Reset Session
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <div className="text-xs font-medium opacity-80">Policy preset</div>
          <select
            className="qg-policy-select w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
            value={state.mode}
            onChange={(e) => onModeChange(e.target.value as PolicyMode)}
            disabled={disabled}
          >
            <option value="FAN_FIRST" className="bg-white text-slate-900">Fan-first (min friction)</option>
            <option value="STRICT" className="bg-white text-slate-900">Strict (aggressive security)</option>
            <option value="ACCESSIBILITY_FIRST" className="bg-white text-slate-900">Accessibility-first</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
            onClick={() => onAttempt("JOIN")}
            disabled={disabled}
          >
            Join Queue
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
            onClick={() => onAttempt("REFRESH")}
            disabled={disabled}
          >
            Refresh
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
            onClick={() => onAttempt("CHECKOUT")}
            disabled={disabled}
          >
            Checkout
          </button>
        </div>

        <div className="pt-2">
          <div className="text-xs font-medium opacity-80">One-click demo scenarios</div>
          <div className="mt-2 space-y-2">
            <button
              className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => run("NORMAL_FAN")}
              disabled={disabled}
            >
              &gt; Normal Fan Flow
            </button>
            <button
              className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => run("SUSPICIOUS_USER")}
              disabled={disabled}
            >
              &gt; Suspicious User Flow
            </button>
            <button
              className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => run("BOT_BURST")}
              disabled={disabled}
            >
              &gt; Bot Burst Attack
            </button>
          </div>
        </div>

        <div className="pt-2 text-xs opacity-80">
          <div><span className="font-medium">Session:</span> {state.sessionId}</div>
          <div><span className="font-medium">Joined?</span> {state.joined ? "Yes" : "No"}</div>
          <div><span className="font-medium">Events:</span> {state.events.length}</div>
          {decision ? (
            <div className="mt-2 rounded-xl bg-black/5 p-3">
              <div className="text-xs font-medium opacity-80">Last decision</div>
              <div className="mt-1 text-sm">
                Risk <span className="font-semibold">{decision.risk}/100</span> -&gt;{" "}
                <span className="font-semibold">{decision.action}</span>
                {decision.action === "STEP_UP" ? ` (L${decision.stepUpLevel})` : ""}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
