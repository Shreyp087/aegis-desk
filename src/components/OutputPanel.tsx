export default function OutputPanel({ stream }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Final structured output (demo-ready).
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 max-h-96">
        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-neutral-100 break-all">
          {stream || "Outputs will appear here after execution."}
        </pre>
      </div>
    </div>
  );
}