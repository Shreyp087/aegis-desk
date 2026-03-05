"use client";

import { clearLedger } from "@/lib/queueguard/ledger";
import type { LedgerEntry } from "@/lib/queueguard/types";

function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LedgerPanel({
  ledger,
  onRefresh,
}: {
  ledger: LedgerEntry[];
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trust Ledger</h2>
          <p className="text-xs opacity-80">
            Append-only log (no raw content). Includes tamper-evident hash chain fields.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-xl border px-3 py-1 text-xs hover:bg-black/5"
            onClick={() => downloadJson("queueguard-ledger.json", ledger)}
          >
            Export JSON
          </button>
          <button
            className="rounded-xl border px-3 py-1 text-xs hover:bg-black/5"
            onClick={() => {
              clearLedger();
              onRefresh();
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {ledger.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm opacity-80">
            No entries yet. Run a scenario to generate auditable events.
          </div>
        ) : (
          ledger.slice(0, 12).map((e, i) => (
            <div key={i} className="rounded-2xl border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">
                  {e.actionAttempted} -&gt; {e.decisionAction} {e.decisionAction === "STEP_UP" ? `(L${e.stepUpLevel})` : ""}
                </div>
                <div className="text-xs opacity-80">{new Date(e.ts).toLocaleTimeString()}</div>
              </div>

              <div className="mt-1 text-xs opacity-80">
                Risk <span className="font-semibold">{e.risk}</span> | Outcome{" "}
                <span className="font-semibold">{e.outcome}</span> | Mode{" "}
                <span className="font-semibold">{e.mode}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {e.topFactors.map((f) => (
                  <span key={f.key} className="rounded-xl bg-black/5 px-2 py-1 text-xs">
                    {f.key}: {f.points}
                  </span>
                ))}
              </div>

              <div className="mt-2 text-[11px] opacity-70">
                friction {e.frictionUsed}/{e.frictionCap} | policy {e.policyVersion}
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs opacity-80">Hash chain</summary>
                <div className="mt-1 break-all text-[11px] opacity-70">
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
