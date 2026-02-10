export default function PlanPanel({ plan }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Step-based plan generated from your command.
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono">
          {plan ? JSON.stringify(plan, null, 2) : "Plan will appear here after you run the agent."}
        </pre>
      </div>
    </div>
  );
}