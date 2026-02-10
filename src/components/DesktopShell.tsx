export default function DesktopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen p-4 bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-semibold">Aegis Desk</div>
        <div className="text-sm text-neutral-400">Local-first • Auditable • Linkup-augmented</div>
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        {children}
      </div>
    </div>
  );
}
