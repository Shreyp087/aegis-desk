type PlanPanelProps = {
  plan: unknown;
  stream: string;
  expanded: boolean;
};

type PlanStep = {
  id?: string;
  type?: string;
  description?: string;
  reason?: string;
};

function planStepsFromValue(plan: unknown): PlanStep[] {
  if (!plan || typeof plan !== "object") return [];
  const maybeSteps = (plan as { steps?: unknown }).steps;
  return Array.isArray(maybeSteps) ? (maybeSteps as PlanStep[]) : [];
}

export default function PlanPanel({ plan, stream, expanded }: PlanPanelProps) {
  const steps = planStepsFromValue(plan);
  const statusCopy = stream || "Review the plan before trusting the downstream draft.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-3 py-3 text-sm text-aegis-muted">
        {statusCopy}
      </div>

      <div className={expanded ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1 overflow-y-auto lg:max-h-96"}>
        {steps.length > 0 ? (
          <div className="grid gap-3">
            {steps.map((step, index) => (
              <div key={step.id || `${step.type || "step"}-${index}`} className="rounded-lg border border-aegis-border bg-aegis-elevated p-4">
                <div className="border-l-2 border-aegis-info pl-3">
                  <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">
                    Step {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-aegis-text">{step.description || step.type || "Structured plan step"}</div>
                  {step.reason ? <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{step.reason}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-aegis-border bg-aegis-elevated p-4">
            <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">Raw Plan</div>
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm font-mono leading-relaxed text-aegis-muted">
              {plan ? JSON.stringify(plan, null, 2) : "Plan will appear here after you run the agent."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
