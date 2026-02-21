export default function DesktopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-3 py-4 md:px-6 md:py-7 text-[color:var(--text)]">
      <div className="futuristic-shell mx-auto max-w-[1600px] p-4 md:p-6">
        <div className="ambient-orb orb-cyan h-24 w-24 -top-7 -left-7" />
        <div className="ambient-orb orb-lime h-20 w-20 top-16 right-16" />

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl border border-[rgba(93,144,198,0.38)] bg-[rgba(12,20,34,0.65)] flex items-center justify-center halo-focus">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" className="text-[var(--accent-cyan)]">
                <path
                  d="M12 2L3 7v6c0 5.1 3.5 9.8 9 11 5.5-1.2 9-5.9 9-11V7l-9-5z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M8.5 12.5l2.2 2.2L15.8 9.6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-semibold heading-spectrum tracking-tight">Aegis Desk</div>
              <div className="text-xs text-[var(--muted)]">Interactive inbox intelligence dashboard</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="status-pill">Local-first</span>
            <span className="status-pill">Auditable</span>
            <span className="status-pill">Tool-grounded</span>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
