export default function ResearchPanel({ research }: any) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">
        Shows what was redacted and what was searched.
      </div>

      <div className="min-h-0 flex-1 overflow-auto space-y-3 max-h-96">
        {research.length === 0 ? (
          <div className="text-neutral-500 text-sm">No research events yet.</div>
        ) : (
          research.map((e: any, idx: number) => (
            <div
              key={idx}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-neutral-200">
                  <span className="font-semibold">{e.type}</span>{" "}
                  <span className="text-neutral-500">— {e.message}</span>
                </div>
              </div>

              {e.data ? (
                <pre className="mt-2 text-sm leading-relaxed whitespace-pre-wrap font-mono text-neutral-200 break-all">
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