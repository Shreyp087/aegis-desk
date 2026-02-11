export default function OutputPanel({ stream }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Final structured output (demo-ready).
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 max-h-96 shadow-inner">
        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-neutral-200 break-all">
          {stream || "Outputs will appear here after execution."}
        </pre>
      </div>
    </div>
  );
}
