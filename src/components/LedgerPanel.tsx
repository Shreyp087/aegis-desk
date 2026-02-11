export default function LedgerPanel({ ledger }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Timeline of what the agent did and why.
      </div>

      <div className="min-h-0 flex-1 overflow-auto space-y-3 max-h-96">
        {ledger.length === 0 ? (
          <div className="text-neutral-500 text-sm">No ledger events yet.</div>
        ) : (
          ledger.map((e: any, idx: number) => (
            <div
              key={idx}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-300">
                  {e.type}
                </span>
                <span className="text-sm text-neutral-200 font-semibold">
                  {e.stepId ? `Step ${e.stepId}` : ""}
                </span>
              </div>
              <div className="mt-2 text-sm text-neutral-200 break-all">{e.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
