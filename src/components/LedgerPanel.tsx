import { EmptyState, StatusBadge } from "@/components/ui/AegisPrimitives";

type LedgerEvent = {
  type?: string;
  stepId?: string | number;
  message?: string;
  ts?: string | number;
  data?: unknown;
};

type LedgerPanelProps = {
  ledger: LedgerEvent[];
  expanded: boolean;
};

function formatEventTime(value: string | number | undefined): string {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toneForType(type: string | undefined): "risk" | "caution" | "clear" | "info" | "muted" {
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("error") || normalized.includes("fail")) return "risk";
  if (normalized.includes("research") || normalized.includes("search")) return "info";
  if (normalized.includes("draft") || normalized.includes("reply")) return "clear";
  if (normalized.includes("verify") || normalized.includes("analyze")) return "caution";
  return "muted";
}

export default function LedgerPanel({ ledger, expanded }: LedgerPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-3 py-3 text-sm text-aegis-muted">
        Timeline of what the agent did, in order, with the local step context preserved.
      </div>

      <div className={expanded ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto lg:max-h-96"}>
        {ledger.length === 0 ? (
          <EmptyState
            className="min-h-56"
            title="No ledger events yet"
            description="Run the analysis to populate the trust ledger with step-by-step activity."
          />
        ) : (
          <div className="grid gap-3">
            {ledger.map((event, index) => (
              <div key={`${event.type || "event"}-${index}`} className="rounded-lg border border-aegis-border bg-aegis-elevated p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={toneForType(event.type)}>{(event.type || "event").toUpperCase()}</StatusBadge>
                      {event.stepId ? <span className="aegis-time">Step {event.stepId}</span> : null}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-aegis-text">{event.message || "No message captured for this event."}</div>
                  </div>
                  <div className="aegis-time">{formatEventTime(event.ts)}</div>
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
