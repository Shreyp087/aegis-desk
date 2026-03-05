"use client";

import type { RiskDecision, SessionState } from "@/lib/queueguard/types";

export default function RiskPanel({
  state,
  decision,
  policyVersion,
}: {
  state: SessionState;
  decision: RiskDecision | null;
  policyVersion: string;
}) {
  return (
    <section className="rounded-2xl border p-4 shadow-sm">
      <h2 className="text-lg font-semibold">Risk & Transparency</h2>
      <p className="text-xs opacity-80">
        Derived behavioral signals only (no raw PII). Decisions are explainable and logged.
      </p>

      <div className="mt-4 rounded-2xl bg-black/5 p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium opacity-80">Friction Budget</div>
          <div className="text-xs opacity-80">Policy: {policyVersion}</div>
        </div>
        <div className="mt-2 text-sm">
          Used <span className="font-semibold">{state.frictionUsed}</span> /{" "}
          <span className="font-semibold">{state.frictionCap}</span>{" "}
          <span className="opacity-70">(lower is better for legit fans)</span>
        </div>
      </div>

      <div className="mt-4">
        {!decision ? (
          <div className="rounded-2xl border p-4 text-sm opacity-80">
            Trigger an action (Join/Refresh/Checkout) to see risk scoring and step-up decisions.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium opacity-80">Risk Score</div>
                <div className="text-xs opacity-80">Latency: {decision.latencyMs}ms</div>
              </div>
              <div className="mt-1 text-2xl font-semibold">{decision.risk}/100</div>
              <div className="mt-1 text-sm">
                Decision: <span className="font-semibold">{decision.action}</span>{" "}
                {decision.action === "STEP_UP" ? (
                  <span className="opacity-80">
                    (Step-up L{decision.stepUpLevel}: {decision.stepUpMethod})
                  </span>
                ) : null}
              </div>

              {decision.notes.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-80">
                  {decision.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="rounded-2xl border p-4">
              <div className="text-xs font-medium opacity-80">Top Factors (Why)</div>
              <div className="mt-2 space-y-2">
                {decision.factors.slice(0, 6).map((f) => (
                  <div key={f.key} className="rounded-xl bg-black/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{f.label}</div>
                      <div className="text-xs opacity-80">{Math.round(f.points)} pts</div>
                    </div>
                    <div className="mt-1 text-xs opacity-80">{f.evidence}</div>
                    <div className="mt-2 h-2 w-full rounded-full bg-black/10">
                      <div
                        className="h-2 rounded-full bg-black/60"
                        style={{ width: `${Math.round(f.score01 * 100)}%` }}
                        aria-label={`${f.label} contribution`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border p-4">
              <div className="text-xs font-medium opacity-80">Privacy & Minimization (what we do NOT store)</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs opacity-80">
                <li>No demographics, no location, no biometrics.</li>
                <li>No raw page content or typed text stored.</li>
                <li>Only derived behavioral signals + decision metadata are logged.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
