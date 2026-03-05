import Link from "next/link";
import DesktopShell from "@/components/DesktopShell";
import QueueGuardConsole from "@/components/queueguard/QueueGuardConsole";

export default function QueueGuardPage() {
  return (
    <DesktopShell>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="surface-card p-4 md:p-5 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold heading-spectrum">Aegis QueueGuard</h1>
            <p className="text-sm text-[var(--muted)]">
              Risk-based queue verification demo with step-up controls, privacy-first signals, and auditable outcomes.
            </p>
          </div>
          <Link
            href="/workspace"
            className="secondary-ghost px-3 py-2 rounded-xl text-sm font-semibold no-underline inline-flex w-fit"
            title="Back to workspace home"
          >
            Back to Workspace Home
          </Link>
        </div>

        <QueueGuardConsole />
      </div>
    </DesktopShell>
  );
}
