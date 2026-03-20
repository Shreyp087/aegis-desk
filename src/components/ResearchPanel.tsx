import { EmptyState, StatusBadge } from "@/components/ui/AegisPrimitives";

type ResearchEvent = {
  type?: string;
  message?: string;
  data?: unknown;
};

type ResearchPanelProps = {
  research: ResearchEvent[];
  expanded: boolean;
};

function toneForResearchType(type: string | undefined): "risk" | "caution" | "clear" | "info" | "muted" {
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("redact")) return "caution";
  if (normalized.includes("search") || normalized.includes("research")) return "info";
  if (normalized.includes("evidence")) return "clear";
  return "muted";
}

export default function ResearchPanel({ research, expanded }: ResearchPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-3 py-3 text-sm text-aegis-muted">
        Review redacted queries, research events, and evidence payloads before you trust the final answer.
      </div>

      <div className={expanded ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto lg:max-h-96"}>
        {research.length === 0 ? (
          <EmptyState
            className="min-h-56"
            title="No research events yet"
            description="Research activity will appear here after the agent executes the search steps."
          />
        ) : (
          <div className="grid gap-3">
            {research.map((event, index) => (
              <div key={`${event.type || "research"}-${index}`} className="rounded-lg border border-aegis-border bg-aegis-elevated p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneForResearchType(event.type)}>{(event.type || "research").toUpperCase()}</StatusBadge>
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-aegis-text">{event.message || "Research event captured."}</div>
                </div>
                {event.data ? (
                  <pre className="mt-3 whitespace-pre-wrap break-all rounded border border-aegis-border bg-aegis-base px-3 py-3 text-xs font-mono leading-relaxed text-aegis-muted">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
