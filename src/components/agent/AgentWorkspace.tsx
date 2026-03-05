"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import CommandPanel from "@/components/CommandPanel";
import LedgerPanel from "@/components/LedgerPanel";
import OutputPanel from "@/components/OutputPanel";
import PanelFrame from "@/components/PanelFrame";
import PlanPanel from "@/components/PlanPanel";
import ResearchPanel from "@/components/ResearchPanel";
import { consumeAgentEscalationPrefill } from "@/lib/agent/prefill";
import { OFFLINE_MODE_TEMPLATE_CONFIG } from "@/lib/offline";

const COMMAND_TEMPLATES = [
  {
    label: "Risk Review",
    value:
      "Summarize this thread, identify legal/security/financial risks, verify key claims with sources, and draft a safe response.",
  },
  {
    label: "Exec Brief",
    value:
      "Create a concise executive brief with top decisions, deadlines, owners, and unresolved risks from this email and document context.",
  },
  {
    label: "Reply + Meeting",
    value:
      "Draft a professional reply, list follow-up questions, and generate a meeting invite with a clear agenda and next steps.",
  },
];

const DEFAULT_COMMAND =
  "Summarize, verify key claims with sources, draft a reply, and create a follow-up meeting invite.";

type LinkupDepth = "standard" | "deep";
const LINKUP_DEPTH_PREF_KEY = "aegis.agent.linkupDepth";

function isLinkupDepth(value: string): value is LinkupDepth {
  return value === "standard" || value === "deep";
}

function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export default function AgentWorkspace() {
  const [emailText, setEmailText] = useState("");
  const [docText, setDocText] = useState("");
  const [command, setCommand] = useState(DEFAULT_COMMAND);
  const [plan, setPlan] = useState<Record<string, unknown> | null>(null);

  const [stream, setStream] = useState<string>("");
  const [ledger, setLedger] = useState<Array<Record<string, unknown>>>([]);
  const [research, setResearch] = useState<Array<Record<string, unknown>>>([]);
  const [outputs, setOutputs] = useState<unknown>(null);
  const [linkupDepth, setLinkupDepth] = useState<LinkupDepth>("standard");

  const [expandedPlan, setExpandedPlan] = useState(false);
  const [expandedLedger, setExpandedLedger] = useState(false);
  const [expandedResearch, setExpandedResearch] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);

  const canRunAgent = emailText.trim().length > 0 && command.trim().length > 0;
  const planStepCount = useMemo(() => {
    if (!plan || typeof plan !== "object") return 0;
    const maybeSteps = (plan as { steps?: unknown }).steps;
    return Array.isArray(maybeSteps) ? maybeSteps.length : 0;
  }, [plan]);

  const readinessLabel = canRunAgent ? "Ready" : "Needs Input";
  const inputWordCount = useMemo(() => countWords(emailText) + countWords(docText), [emailText, docText]);
  const offlinePublicState =
    process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || OFFLINE_MODE_TEMPLATE_CONFIG.state;
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";
  const offlinePublicEnforced = offlinePublicEnabled && offlinePublicState === "enforced";

  const clearWorkspace = useCallback(() => {
    setEmailText("");
    setDocText("");
    setCommand(DEFAULT_COMMAND);
    setPlan(null);
    setStream("");
    setLedger([]);
    setResearch([]);
    setOutputs(null);
    setPrefillNotice(null);
  }, []);

  const runAgent = useCallback(async () => {
    if (offlinePublicEnforced) {
      setStream("Agent plan/run endpoints are disabled while offline mode is enforced.");
      return;
    }

    if (!canRunAgent || isRunning) {
      if (!canRunAgent) {
        setOutputs(null);
        setStream("Run Agent requires both Email and Command.");
      }
      return;
    }

    setIsRunning(true);
    setStream("Planning workflow...");
    setLedger([]);
    setResearch([]);
    setOutputs(null);
    setPlan(null);

    try {
      const planRes = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailText, docText, command }),
      });

      const planData = await planRes.json();
      if (!planRes.ok || !planData?.ok) {
        setStream(planData?.detail || planData?.error || "Plan failed.");
        return;
      }

      setPlan(planData.plan);
      setStream("Executing plan...");

      const runRes = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planData.plan,
          emailText,
          docText,
          command,
          options: { linkupDepth },
        }),
      });

      const runData = await runRes.json();
      if (!runRes.ok || !runData?.ok) {
        setStream(runData?.detail || runData?.error || "Run failed.");
        return;
      }

      setLedger(runData.ledger || []);
      setResearch(runData.research || []);
      setOutputs(runData.final || null);
      setStream("");
    } catch {
      setStream("Unable to reach backend. Check your local API server and try again.");
    } finally {
      setIsRunning(false);
    }
  }, [canRunAgent, command, docText, emailText, isRunning, linkupDepth, offlinePublicEnforced]);

  useEffect(() => {
    const prefill = consumeAgentEscalationPrefill();
    if (!prefill) return;

    if (prefill.rawEmail) setEmailText(prefill.rawEmail);
    if (prefill.command) setCommand(prefill.command);
    setPrefillNotice("Loaded email context from Inbox Scanner.");
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LINKUP_DEPTH_PREF_KEY);
      if (stored && isLinkupDepth(stored)) {
        setLinkupDepth(stored);
      }
    } catch {
      // ignore storage access issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LINKUP_DEPTH_PREF_KEY, linkupDepth);
    } catch {
      // ignore storage access issues
    }
  }, [linkupDepth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runAgent();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runAgent]);

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="flex w-full lg:w-auto items-center gap-2 flex-wrap">
          <span className="subtle-pill px-3 py-2 rounded-full text-xs text-[var(--muted)]">
            Agent Desk Workspace
          </span>
          <span className="subtle-pill px-3 py-2 rounded-full text-xs text-[var(--muted)]">
            Offline Mode: {offlinePublicState} ({offlinePublicEnabled ? "active" : "inactive"})
          </span>
        </div>

        <div className="text-xs sm:text-sm text-[var(--muted)] subtle-pill px-4 py-2 rounded-full w-full lg:w-auto">
          Shortcut: Ctrl/Cmd + Enter to run.
        </div>
      </div>

      {prefillNotice ? (
        <div className="surface-card p-3 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-200">{prefillNotice}</div>
          <button
            type="button"
            onClick={() => setPrefillNotice(null)}
            className="secondary-ghost px-3 py-1.5 rounded-lg text-sm"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="dashboard-metric-grid mb-3">
        <div className="metric-card">
          <div className="metric-label">Workspace</div>
          <div className="metric-value">{readinessLabel}</div>
          <div className="metric-hint">{canRunAgent ? "Email and command are set." : "Add email and command."}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Input Volume</div>
          <div className="metric-value">{inputWordCount}</div>
          <div className="metric-hint">Words across email + document.</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Plan / Events</div>
          <div className="metric-value">{planStepCount} steps</div>
          <div className="metric-hint">
            {ledger.length} ledger | {research.length} research
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Execution</div>
          <div className="metric-value">
            {offlinePublicEnforced ? "Offline Locked" : isRunning ? "Running..." : outputs ? "Complete" : "Idle"}
          </div>
          <div className="metric-hint">
            {offlinePublicEnforced ? "Plan/Run APIs are blocked in enforced mode." : stream || "Run to generate outputs."}
          </div>
        </div>
      </div>

      <div className="quick-template-row mb-3 mobile-chip-scroll">
        <span className="quick-template-label">Command templates</span>
        {COMMAND_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() => setCommand(template.value)}
            className="quick-template-chip"
          >
            {template.label}
          </button>
        ))}
      </div>

      <div className="surface-card p-3 mb-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-[var(--muted)]">
          LinkUp Search Depth
        </label>
        <select
          value={linkupDepth}
          onChange={(e) => setLinkupDepth(e.target.value as LinkupDepth)}
          className="field-input text-sm w-[220px]"
          disabled={isRunning || offlinePublicEnforced}
        >
          <option value="standard">Standard (default, lower cost)</option>
          <option value="deep">Deep (manual, higher cost)</option>
        </select>
        <span className="text-xs text-[var(--muted)]">
          Deep mode is off by default and only used when you explicitly enable it here.
        </span>
      </div>

      <div className="agent-dashboard grid gap-3 min-h-0">
        <PanelFrame
          title="Command + Inputs"
          subtitle="Paste email/doc context, refine command, and run from this single workspace."
          className="pb-0"
          actionButton={
            <div className="flex w-full sm:w-auto items-center justify-end gap-2 flex-wrap panel-head-actions">
              <button
                type="button"
                onClick={clearWorkspace}
                className="secondary-ghost px-3 py-2 rounded-xl text-sm font-semibold min-h-[40px]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={runAgent}
                disabled={!canRunAgent || isRunning || offlinePublicEnforced}
                title={
                  offlinePublicEnforced
                    ? "Disabled while offline mode is enforced."
                    : !canRunAgent
                      ? "Add Email and Command to run the agent."
                      : "Run Agent"
                }
                className="primary-cta px-4 py-2.5 rounded-xl font-semibold min-h-[40px] w-full sm:w-auto active:scale-95 cursor-pointer transition-all duration-200 text-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isRunning ? "Running..." : "Run Agent"}
              </button>
            </div>
          }
        >
          <CommandPanel
            emailText={emailText}
            setEmailText={setEmailText}
            docText={docText}
            setDocText={setDocText}
            command={command}
            setCommand={setCommand}
          />
        </PanelFrame>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 min-h-0">
          <PanelFrame
            title="Intent Compiler (Plan)"
            subtitle="What the agent intends to do (step-based, tool-driven)."
            className="pt-0"
            actionButton={
              <button
                type="button"
                onClick={() => setExpandedPlan(!expandedPlan)}
                className="text-[var(--muted)] hover:text-[var(--accent-cyan)] transition-colors duration-200"
                title={expandedPlan ? "Collapse Plan Panel" : "Expand Plan Panel"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={
                      expandedPlan
                        ? "M6 18L18 6M6 6l12 12"
                        : "M4 8V4m0 0h4m-4 0l5 5m11-1V4m0 0h-4m4 0l-5 5"
                    }
                  />
                </svg>
              </button>
            }
          >
            <PlanPanel plan={plan} stream={stream} expanded={expandedPlan} />
          </PanelFrame>

          <PanelFrame
            title="Trust Ledger (Replay)"
            subtitle="Auditable timeline of actions, decisions, and tool calls."
            className="pt-0"
            actionButton={
              <button
                type="button"
                onClick={() => setExpandedLedger(!expandedLedger)}
                className="text-[var(--muted)] hover:text-[var(--accent-cyan)] transition-colors duration-200"
                title={expandedLedger ? "Collapse Ledger Panel" : "Expand Ledger Panel"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={
                      expandedLedger
                        ? "M6 18L18 6M6 6l12 12"
                        : "M4 8V4m0 0h4m-4 0l5 5m11-1V4m0 0h-4m4 0l-5 5"
                    }
                  />
                </svg>
              </button>
            }
          >
            <LedgerPanel ledger={ledger} expanded={expandedLedger} />
          </PanelFrame>

          <PanelFrame
            title="Web Research (Linkup + Redaction)"
            subtitle="Redacted queries + sources used to ground decisions."
            className="pt-0"
            actionButton={
              <button
                type="button"
                onClick={() => setExpandedResearch(!expandedResearch)}
                className="text-[var(--muted)] hover:text-[var(--accent-cyan)] transition-colors duration-200"
                title={expandedResearch ? "Collapse Research Panel" : "Expand Research Panel"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={
                      expandedResearch
                        ? "M6 18L18 6M6 6l12 12"
                        : "M4 8V4m0 0h4m-4 0l5 5m11-1V4m0 0h-4m4 0l-5 5"
                    }
                  />
                </svg>
              </button>
            }
          >
            <ResearchPanel research={research} expanded={expandedResearch} />
          </PanelFrame>
        </div>

        <PanelFrame
          title="Outputs (Drafts + Evidence)"
          subtitle="Final deliverable: verdicts, risks, drafts, and artifacts."
        >
          <OutputPanel stream={stream} outputs={outputs} />
        </PanelFrame>
      </div>

      <style jsx global>{`
        @media (min-width: 1024px) {
          .agent-dashboard {
            grid-template-rows: minmax(330px, 2.2fr) minmax(280px, 1.1fr) minmax(290px, 1.4fr);
          }
        }
      `}</style>
    </>
  );
}
