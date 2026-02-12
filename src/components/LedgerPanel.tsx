export default function LedgerPanel({ ledger, expanded }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Timeline of what the agent did and why.
      </div>

      <div className={`min-h-0 flex-1 overflow-auto space-y-3 ${expanded ? 'max-h-none' : 'max-h-96'}`}>
        {ledger.length === 0 ? (
          <div className="text-neutral-500 text-sm italic">No ledger events yet.</div>
        ) : (
          ledger.map((e: any, idx: number) => (
            <div
              key={idx}
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:bg-white/10 transition-all duration-300 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-medium">
                  {e.type}
                </span>
                <span className="text-sm text-neutral-200 font-semibold">
                  {e.stepId ? `Step ${e.stepId}` : ""}
                </span>
              </div>
              <div className="mt-2 text-sm text-neutral-300 break-all leading-relaxed">{e.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
