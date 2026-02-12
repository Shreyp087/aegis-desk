export default function PlanPanel({ plan, expanded }: any) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Step-based plan generated from your command.
      </div>

      <div className={`min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 shadow-inner ${expanded ? 'max-h-none' : 'max-h-96'}`}>
         <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono break-all text-neutral-300">
          {plan ? JSON.stringify(plan, null, 2) : "Plan will appear here after you run the agent."}
        </pre>

      </div>
    </div>
  );
}
