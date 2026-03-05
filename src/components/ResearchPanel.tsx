type ResearchEvent = {
  type?: string;
  message?: string;
  data?: unknown;
};

type ResearchPanelProps = {
  research: ResearchEvent[];
  expanded: boolean;
};

export default function ResearchPanel({ research, expanded }: ResearchPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="panel-note">Shows what was redacted and what was searched.</div>

      <div className={`min-h-0 flex-1 overflow-auto space-y-3 ${expanded ? 'max-h-none' : 'max-h-none md:max-h-96'}`}>
        {research.length === 0 ? (
          <div className="panel-empty text-sm italic">No research events yet.</div>
        ) : (
          research.map((e, idx) => (
            <div
              key={idx}
              className="event-card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-[var(--text)]">
                  <span className="font-semibold text-[var(--accent-cyan)]">{e.type}</span>{" "}
                  <span className="text-[var(--muted)]">- {e.message}</span>
                </div>
              </div>

              {e.data ? (
                <pre className="mt-3 panel-mono text-sm leading-relaxed whitespace-pre-wrap break-all inner-code p-3">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
