export default function ResearchPanel({ research }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Shows what was redacted and what was searched.
      </div>

      <div className="min-h-0 flex-1 overflow-auto space-y-3 max-h-96">
        {research.length === 0 ? (
          <div className="text-neutral-500 text-sm italic">No research events yet.</div>
        ) : (
          research.map((e: any, idx: number) => (
            <div
              key={idx}
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:bg-white/10 transition-all duration-300 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-neutral-200">
                  <span className="font-semibold text-blue-300">{e.type}</span>{" "}
                  <span className="text-neutral-400">— {e.message}</span>
                </div>
              </div>

              {e.data ? (
                <pre className="mt-3 text-sm leading-relaxed whitespace-pre-wrap font-mono text-neutral-300 break-all bg-black/20 p-3 rounded-lg border border-white/5">
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
