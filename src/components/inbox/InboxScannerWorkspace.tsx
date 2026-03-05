"use client";

import { useRouter } from "next/navigation";

import InboxScannerPanel from "@/components/InboxScannerPanel";
import PanelFrame from "@/components/PanelFrame";
import { stashAgentEscalationPrefill } from "@/lib/agent/prefill";

export default function InboxScannerWorkspace() {
  const router = useRouter();

  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || "disabled";
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";

  return (
    <div className="min-h-0 flex flex-col gap-4">
      <div className="surface-card p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold heading-spectrum">Inbox Scanner Workspace</div>
            <div className="text-sm text-[var(--muted)]">
              Review incoming email risk, filter results, and escalate selected messages into the Agent Desk.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="subtle-pill px-3 py-2 rounded-full text-[var(--muted)]">
              Offline Mode: {offlinePublicState} ({offlinePublicEnabled ? "active" : "inactive"})
            </span>
            <span className="subtle-pill px-3 py-2 rounded-full text-[var(--muted)]">
              Workflow: Scan -&gt; Review -&gt; Escalate
            </span>
          </div>
        </div>
      </div>

      <PanelFrame
        title="Inbox Risk Scanner"
        subtitle="Scan inbox, rank risks, and send selected emails to the Agent Desk with a prefilled command."
      >
        <InboxScannerPanel
          onEscalate={(rawEmail, escalatedCommand) => {
            stashAgentEscalationPrefill({ rawEmail, command: escalatedCommand });
            router.push("/agent");
          }}
        />
      </PanelFrame>
    </div>
  );
}
