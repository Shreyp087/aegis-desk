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
  className,
  actionButton,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actionButton?: React.ReactNode;
}) {
  return (
    <div className="h-full min-h-0 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md flex flex-col overflow-hidden shadow-xl hover:shadow-2xl transition-shadow duration-300">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-white/5 to-transparent">
        <div>
          <div className="text-base font-semibold truncate bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent">{title}</div>
          {subtitle ? (
            <div className="text-sm text-neutral-400 truncate">{subtitle}</div>
          ) : null}
        </div>
        {actionButton}
      </div>

      <div className={`min-h-0 flex-1 overflow-auto p-5 ${className || ""}`}>{children}</div>
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-3 p-1.5 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("agent")}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
              activeTab === "agent"
                ? "bg-white text-black shadow-lg shadow-white/20"
                : "text-neutral-300 hover:text-white hover:bg-white/10"
            }`}
          >
            Agent
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("inbox")}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
              activeTab === "inbox"
                ? "bg-white text-black shadow-lg shadow-white/20"
                : "text-neutral-300 hover:text-white hover:bg-white/10"
            }`}
          >
            Inbox Scanner
          </button>
        </div>

        <div className="hidden md:block text-sm text-neutral-400 bg-white/5 px-4 py-2 rounded-full border border-white/10 backdrop-blur-sm">
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
          {/* One dashboard: 3 rows. Row 1 full width, Row 2 3 cols, Row 3 full width. */}
          <div className="agent-dashboard gap-2 min-h-0">
            {/* Row 1: Full width Command + Inputs */}
            <PanelFrame
              title="Command + Inputs"
              subtitle="Paste email + doc text, then give one natural-language instruction."
              className="pb-0"
              actionButton={
                <button
                  onClick={runAgent}
                  className="group px-4 py-3 rounded-xl bg-gradient-to-r from-white to-neutral-100 text-black font-bold hover:from-neutral-100 hover:to-white shadow-lg hover:shadow-xl active:scale-95 active:shadow-md cursor-pointer transition-all duration-200 text-sm flex items-center gap-2"
                >
                  <span>Run Agent</span>
                  <svg 
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200" 
                    fill="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path d="M21 10.5c0-1.5-1-2.5-2.5-2.5h-1.5v-2c0-1.5-1-2.5-2.5-2.5s-2.5 1-2.5 2.5v6.5l-2.2-1.1c-.5-.3-1.1-.3-1.6 0l-5.2 2.6c-.8.4-1.1 1.3-.7 2.1.4.8 1.3 1.1 2.1.7l4.6-2.3 3.5 1.8c.3.1.6.2.9.2h4c1.5 0 2.5-1 2.5-2.5v-5z"/>
                  </svg>
                </button>
              }
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

            {/* Row 2: 3 parallel columns for panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-96">
              <PanelFrame
                title="Intent Compiler (Plan)"
                subtitle="What the agent intends to do (step-based, tool-driven)."
                className="pt-0"
              >
                <PlanPanel plan={plan} stream={stream} />
              </PanelFrame>

              <PanelFrame
                title="Trust Ledger (Replay)"
                subtitle="Auditable timeline of actions, decisions, and tool calls."
                className="pt-0"
              >
                <LedgerPanel ledger={ledger} />
              </PanelFrame>

              <PanelFrame
                title="Web Research (Linkup + Redaction)"
                subtitle="Redacted queries + sources used to ground decisions."
                className="pt-0"
              >
                <ResearchPanel research={research} />
              </PanelFrame>
            </div>

            {/* Row 3: Full width Output */}
            <PanelFrame
              title="Outputs (Drafts + Evidence)"
              subtitle="Final deliverable: verdicts, risks, drafts, and artifacts."
            >
              <OutputPanel stream={stream} outputs={outputs} />
            </PanelFrame>
          </div>

          {/* Desktop row proportions: Command/Inputs larger, panels equal, Output smaller */}
          <style jsx global>{`
            @media (min-width: 1024px) {
              .agent-dashboard {
                grid-template-rows: 3fr 1fr 1fr;
              }
            }
          `}</style>
        </>
      )}
    </DesktopShell>
  );
}