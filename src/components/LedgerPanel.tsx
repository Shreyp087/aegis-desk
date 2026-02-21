type LedgerEvent = {
  type?: string;
  stepId?: string | number;
  message?: string;
};

type LedgerPanelProps = {
  ledger: LedgerEvent[];
  expanded: boolean;
};

export default function LedgerPanel({ ledger, expanded }: LedgerPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="panel-note">Timeline of what the agent did and why.</div>

      <div className={`min-h-0 flex-1 overflow-auto space-y-3 ${expanded ? 'max-h-none' : 'max-h-96'}`}>
        {ledger.length === 0 ? (
          <div className="panel-empty text-sm italic">No ledger events yet.</div>
        ) : (
          ledger.map((e, idx) => (
            <div
              key={idx}
              className="event-card p-4"
            >
              <div className="flex items-center gap-2">
                <span className="event-badge text-xs px-3 py-1 rounded-full font-medium">
                  {e.type}
                </span>
                <span className="text-sm text-[var(--text)] font-semibold">
                  {e.stepId ? `Step ${e.stepId}` : ""}
                </span>
              </div>
              <div className="mt-2 text-sm text-[var(--muted)] break-all leading-relaxed">{e.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
