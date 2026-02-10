// src/app/page.tsx
"use client";

import { useState } from "react";

import DesktopShell from "@/components/DesktopShell";
import CommandPanel from "@/components/CommandPanel";
import PlanPanel from "@/components/PlanPanel";
import ResearchPanel from "@/components/ResearchPanel";
import LedgerPanel from "@/components/LedgerPanel";
import OutputPanel from "@/components/OutputPanel";
import InboxScannerPanel from "@/components/InboxScannerPanel";

/** Non-collapsible, viewport-safe panel wrapper */
function PanelFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full min-h-0 rounded-2xl border border-neutral-800 bg-neutral-950 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800">
        <div className="text-base font-semibold truncate">{title}</div>
        {subtitle ? (
          <div className="text-sm text-neutral-500 truncate">{subtitle}</div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"agent" | "inbox">("agent");

  const [emailText, setEmailText] = useState("");
  const [docText, setDocText] = useState("");
  const [command, setCommand] = useState(
    "Summarize, verify key claims with sources, draft a reply, and create a follow-up meeting invite."
  );
  const [plan, setPlan] = useState<any>(null);

  const [stream, setStream] = useState<string>("");
  const [ledger, setLedger] = useState<any[]>([]);
  const [research, setResearch] = useState<any[]>([]);
  const [outputs, setOutputs] = useState<any>(null);

  async function runAgent() {
    setStream("");
    setLedger([]);
    setResearch([]);
    setOutputs(null);
    setPlan(null);

    const planRes = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailText, docText, command }),
    });
    const planData = await planRes.json();
    if (!planData.ok) {
      setStream(JSON.stringify(planData, null, 2));
      return;
    }
    setPlan(planData.plan);

    const runRes = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planData.plan, emailText, docText, command }),
    });

    const runData = await runRes.json();
    setLedger(runData.ledger || []);
    setResearch(runData.research || []);
    setStream(JSON.stringify(runData.final || runData, null, 2));
  }

  return (
    <DesktopShell>
      {/* Tabs */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("agent")}
            className={`px-3 py-2 rounded-xl text-sm border transition ${
              activeTab === "agent"
                ? "bg-white text-black border-white"
                : "bg-neutral-950 text-neutral-200 border-neutral-800 hover:bg-neutral-900"
            }`}
          >
            Agent
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("inbox")}
            className={`px-3 py-2 rounded-xl text-sm border transition ${
              activeTab === "inbox"
                ? "bg-white text-black border-white"
                : "bg-neutral-950 text-neutral-200 border-neutral-800 hover:bg-neutral-900"
            }`}
          >
            Inbox Scanner
          </button>
        </div>

        <div className="hidden md:block text-sm text-neutral-500">
          Demo flow: Inbox → Escalate → Agent executes plan + Linkup evidence.
        </div>
      </div>

      {activeTab === "inbox" ? (
        <div className="min-h-0">
          <PanelFrame
            title="Inbox Scanner"
            subtitle="Manual inbox triage + escalation to the main agent."
          >
            <InboxScannerPanel
              onEscalate={(rawEmail, escalatedCommand) => {
                setEmailText(rawEmail || "");
                setCommand(
                  escalatedCommand ||
                    "Analyze this email. Extract urgency/deadlines, assess security/legal/payment risks, and draft the safest next reply. If risky, propose verification steps."
                );
                setActiveTab("agent");
              }}
            />
          </PanelFrame>
        </div>
      ) : (
        <>
          {/* One dashboard: 3 rows, 2 cols (tablet+). Scrollable. */}
          <div className="agent-dashboard grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">
            {/* Row 1 */}
            <PanelFrame
              title="Command + Inputs"
              subtitle="Paste email + doc text, then give one natural-language instruction."
            >
              <CommandPanel
                emailText={emailText}
                setEmailText={setEmailText}
                docText={docText}
                setDocText={setDocText}
                command={command}
                setCommand={setCommand}
                onRun={runAgent}
              />
            </PanelFrame>

            <PanelFrame
              title="Intent Compiler (Plan)"
              subtitle="What the agent intends to do (step-based, tool-driven)."
            >
              <PlanPanel plan={plan} stream={stream} />
            </PanelFrame>

            {/* Row 2 */}
            <PanelFrame
              title="Web Research (Linkup + Redaction)"
              subtitle="Redacted queries + sources used to ground decisions."
            >
              <ResearchPanel research={research} />
            </PanelFrame>

            <PanelFrame
              title="Trust Ledger (Replay)"
              subtitle="Auditable timeline of actions, decisions, and tool calls."
            >
              <LedgerPanel ledger={ledger} />
            </PanelFrame>

            {/* Row 3 (full width) */}
            <div className="lg:col-span-2 min-h-0">
              <PanelFrame
                title="Outputs (Drafts + Evidence)"
                subtitle="Final deliverable: verdicts, risks, drafts, and artifacts."
              >
                <OutputPanel stream={stream} outputs={outputs} />
              </PanelFrame>
            </div>
          </div>

          {/* Desktop row proportions: make Command/Inputs much bigger, others smaller */}
          <style jsx global>{`
            @media (min-width: 1024px) {
              .agent-dashboard {
                grid-template-rows: 2.5fr 1fr 1fr;
              }
            }
          `}</style>
        </>
      )}
    </DesktopShell>
  );
}