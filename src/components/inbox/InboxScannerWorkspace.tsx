"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import InboxScannerPanel from "@/components/InboxScannerPanel";
import { MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import { stashAgentEscalationPrefill } from "@/lib/agent/prefill";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function InboxScannerWorkspace() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || "disabled";
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <section
        id="scanner-controls"
        className={cn(
          "grid gap-6 rounded-3xl border border-foreground/8 bg-surface/90 px-6 py-6 backdrop-blur-sm transition-all duration-300 md:px-8 md:py-8",
          isReady ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        )}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-foreground/40">
              Inbox Scanner
            </p>
            <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground md:text-5xl">
              Review incoming email risk and move only the right cases to the main agent.
            </h1>
            <p className="mt-4 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
              This surface is tuned for fast triage: scan the queue, inspect the why behind a message, and take a
              clear next step without leaving the flow.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={offlinePublicEnabled ? "caution" : "muted"}>Offline {offlinePublicState}</StatusBadge>
            <StatusBadge tone="info">Scan · Review · Escalate</StatusBadge>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Workspace", value: "Queue", sub: "Three-pane triage surface." },
            { label: "Priority", value: "High first", sub: "Scanner ranks review order.", tone: "caution" as const },
            { label: "Follow-through", value: "Agent Desk", sub: "Escalate only selected cases.", tone: "info" as const },
            {
              label: "Mode",
              value: offlinePublicEnabled ? "Offline-aware" : "Hybrid",
              sub: offlinePublicEnabled ? "External paths may be limited." : "Gmail and remote analysis available.",
              tone: offlinePublicEnabled ? ("caution" as const) : ("clear" as const),
            },
          ].map((card, index) => (
            <div
              key={card.label}
              className="transition-all duration-300"
              style={{ transitionDelay: `${index * 60}ms` }}
            >
              <MetricCard label={card.label} value={card.value} sub={card.sub} tone={card.tone} />
            </div>
          ))}
        </div>
      </section>

      <InboxScannerPanel
        onEscalate={({ rawEmail, command, scannerContext }) => {
          stashAgentEscalationPrefill({ rawEmail, command, scannerContext });
          router.push("/agent");
        }}
      />
    </div>
  );
}
