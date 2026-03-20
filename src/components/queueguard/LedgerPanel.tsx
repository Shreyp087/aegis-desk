"use client";

import { clearLedger } from "@/lib/queueguard/ledger";
import type { LedgerEntry } from "@/lib/queueguard/types";
import { AegisButton, EmptyState, StatusBadge } from "@/components/ui/AegisPrimitives";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LedgerPanel({ ledger, onRefresh }: { ledger: LedgerEntry[]; onRefresh: () => void }) {
  return (
    <section id="queueguard-ledger" className="flex min-h-0 flex-col rounded-2xl border border-foreground/8 bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground/6 pb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium tracking-tight text-foreground">Trust Ledger</h2>
          <p className="mt-1 text-sm font-light leading-relaxed text-foreground/60">
            Append-only operational log with hash chain metadata.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AegisButton variant="secondary" onClick={() => downloadJson("queueguard-ledger.json", ledger)}>
            Export JSON
          </AegisButton>
          <AegisButton
            variant="ghost"
            onClick={() => {
              clearLedger();
              onRefresh();
            }}
          >
            Clear
          </AegisButton>
        </div>
      </div>

      <div className="mt-4 flex-1 min-h-0 space-y-2 overflow-y-auto">
        {ledger.length === 0 ? (
          <EmptyState title="No ledger entries yet" description="Run a scenario to generate auditable events." />
        ) : (
          ledger.slice(0, 12).map((e, i) => (
            <div key={i} style={{ transitionDelay: `${i * 35}ms` }} className="rounded-2xl border border-foreground/8 bg-background/70 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">
                  {e.actionAttempted} {"->"} {e.decisionAction} {e.decisionAction === "STEP_UP" ? `(L${e.stepUpLevel})` : ""}
                </div>
                <div className="font-mono tabular-nums text-foreground/50">{new Date(e.ts).toLocaleTimeString()}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge tone={e.outcome.includes("FAILED") || e.outcome === "BLOCKED" ? "risk" : e.outcome.includes("THROTTLED") ? "caution" : "info"}>
                  {e.outcome}
                </StatusBadge>
                <StatusBadge tone="muted">Risk {e.risk}</StatusBadge>
                <StatusBadge tone="muted">Mode {e.mode}</StatusBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {e.topFactors.map((f) => (
                  <span key={f.key} className="rounded-full border border-foreground/8 bg-surface px-2 py-1 font-mono text-[11px] text-foreground/60">
                    {f.key}: {f.points}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-xs text-foreground/50">
                friction {e.frictionUsed}/{e.frictionCap} · policy {e.policyVersion}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-mono text-foreground/50">Hash chain</summary>
                <div className="mt-2 break-all text-xs text-foreground/60">
                  <div>prevHash: {e.prevHash || "(none)"}</div>
                  <div>entryHash: {e.entryHash || "(computing...)"}</div>
                </div>
              </details>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
