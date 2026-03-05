type PlanPanelProps = {
  plan: unknown;
  stream: string;
  expanded: boolean;
};

export default function PlanPanel({ plan, stream, expanded }: PlanPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="panel-note">{stream || "Step-based plan generated from your command."}</div>

      <div className={`scroll-surface min-h-0 flex-1 overflow-auto p-4 ${expanded ? "max-h-none" : "max-h-none md:max-h-96"}`}>
        <pre className="panel-mono text-sm leading-relaxed whitespace-pre-wrap break-all">
          {plan ? JSON.stringify(plan, null, 2) : "Plan will appear here after you run the agent."}
        </pre>
      </div>
    </div>
  );
}
