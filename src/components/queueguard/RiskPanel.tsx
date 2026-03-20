"use client";

import { MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
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
    <section className="flex min-h-0 flex-col rounded-2xl border border-foreground/8 bg-surface p-5 shadow-sm">
      <div className="border-b border-foreground/6 pb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">Risk and Transparency</h2>
        <p className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
          Derived behavioral signals only. Decisions stay explainable and logged.
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
        <MetricCard label="Friction Budget" value={`${state.frictionUsed}/${state.frictionCap}`} sub={`Policy ${policyVersion}`} tone="caution" />
        <MetricCard
          label="Current Risk"
          value={decision ? `${decision.risk}/100` : "--"}
          sub={decision ? `${decision.action}${decision.action === "STEP_UP" ? ` · L${decision.stepUpLevel}` : ""}` : "Trigger an action"}
          tone={decision && decision.risk >= 75 ? "risk" : decision && decision.risk >= 40 ? "caution" : "clear"}
        />
      </div>

      <div className="mt-4 flex-1 min-h-0 space-y-3 overflow-y-auto">
        {!decision ? (
          <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4 text-sm font-light text-foreground/60">
            Trigger an action to see risk scoring, top factors, and step-up decisions.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono uppercase tracking-widest opacity-40">Decision</div>
                <StatusBadge tone={decision.action === "BLOCK" ? "risk" : decision.action === "STEP_UP" ? "caution" : "clear"}>
                  {decision.action}
                </StatusBadge>
              </div>
              <div className="mt-2 text-sm font-light text-foreground/60">Latency {decision.latencyMs}ms</div>
              {decision.notes.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-light text-foreground/60">
                  {decision.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Top Factors</div>
              <div className="mt-3 space-y-3">
                {decision.factors.slice(0, 6).map((f) => (
                  <div key={f.key} className="rounded-2xl border border-foreground/8 bg-surface p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{f.label}</div>
                      <div className="text-xs font-mono tabular-nums opacity-50">{Math.round(f.points)} pts</div>
                    </div>
                    <div className="mt-1 text-sm font-light text-foreground/60">{f.evidence}</div>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-foreground/10">
                      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.round(f.score01 * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Privacy and Minimization</div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-light text-foreground/60">
                <li>No demographics, no location, no biometrics.</li>
                <li>No raw page content or typed text stored.</li>
                <li>Only derived behavioral signals and decision metadata are logged.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
