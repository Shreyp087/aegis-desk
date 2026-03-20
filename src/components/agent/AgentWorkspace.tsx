"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import CommandPanel from "@/components/CommandPanel";
import LedgerPanel from "@/components/LedgerPanel";
import OutputPanel from "@/components/OutputPanel";
import PanelFrame from "@/components/PanelFrame";
import PlanPanel from "@/components/PlanPanel";
import ResearchPanel from "@/components/ResearchPanel";
import { AegisButton, MetricCard, ProcessingBadge, StatusBadge } from "@/components/ui/AegisPrimitives";
import { clearAgentEscalationPrefill, readAgentEscalationPrefill } from "@/lib/agent/prefill";
import { OFFLINE_MODE_TEMPLATE_CONFIG } from "@/lib/offline";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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
  const [isReady, setIsReady] = useState(false);

  const canRunAgent = emailText.trim().length > 0 && command.trim().length > 0;
  const planStepCount = useMemo(() => {
    if (!plan || typeof plan !== "object") return 0;
    const maybeSteps = (plan as { steps?: unknown }).steps;
    return Array.isArray(maybeSteps) ? maybeSteps.length : 0;
  }, [plan]);

  const readinessLabel = canRunAgent ? "Ready" : "Needs Input";
  const inputWordCount = useMemo(() => countWords(emailText) + countWords(docText), [emailText, docText]);
  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || OFFLINE_MODE_TEMPLATE_CONFIG.state;
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
    const prefill = readAgentEscalationPrefill();
    if (!prefill) return undefined;

    if (prefill.rawEmail) setEmailText(prefill.rawEmail);
    if (prefill.command) setCommand(prefill.command);
    setPrefillNotice("Loaded email context from Inbox Scanner.");

    // Clear after the hydrated mount so development remounts do not lose the prefill.
    const timeoutId = window.setTimeout(() => {
      clearAgentEscalationPrefill();
    }, 250);

    return () => window.clearTimeout(timeoutId);
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <section
        id="agent-brief"
        className={cn(
          "grid gap-6 rounded-3xl border border-foreground/8 bg-surface/90 px-6 py-6 backdrop-blur-sm transition-all duration-300 md:px-8 md:py-8",
          isReady ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        )}
      >
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-foreground/40">
              Reasoning Cockpit
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-light tracking-tight text-foreground md:text-6xl lg:text-7xl">
              Structured planning, research, and draft generation in one controlled desk.
            </h1>
            <p className="mt-4 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
              Paste the thread, define the analytical objective, inspect the plan and trust ledger, and only then use
              the generated output.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={offlinePublicEnforced ? "risk" : offlinePublicEnabled ? "caution" : "muted"}>
              Offline {offlinePublicState}
            </StatusBadge>
            {isRunning ? <ProcessingBadge label="Running" /> : <StatusBadge tone="info">{readinessLabel}</StatusBadge>}
          </div>
        </div>

        {prefillNotice ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-foreground/8 bg-background/60 px-4 py-3">
            <div className="text-sm text-foreground/60">{prefillNotice}</div>
            <AegisButton variant="ghost" onClick={() => setPrefillNotice(null)}>
              Dismiss
            </AegisButton>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Workspace", value: readinessLabel, sub: canRunAgent ? "Input and command present." : "Add thread and command." },
            { label: "Input Volume", value: inputWordCount, sub: "Words across email and supporting context." },
            {
              label: "Plan / Events",
              value: `${planStepCount} steps`,
              sub: `${ledger.length} ledger · ${research.length} research`,
              tone: "info" as const,
            },
            {
              label: "Execution",
              value: offlinePublicEnforced ? "Offline Locked" : isRunning ? "Running" : outputs ? "Complete" : "Idle",
              sub: offlinePublicEnforced ? "Plan/run APIs blocked in enforced mode." : stream || "No active run.",
              tone: offlinePublicEnforced ? ("risk" as const) : outputs ? ("clear" as const) : isRunning ? ("caution" as const) : ("muted" as const),
            },
          ].map((card, index) => (
            <div key={card.label} className="min-w-0 transition-all duration-300" style={{ transitionDelay: `${index * 60}ms` }}>
              <MetricCard label={card.label} value={card.value} sub={card.sub} tone={card.tone} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {COMMAND_TEMPLATES.map((template, index) => (
              <button
                key={template.label}
                type="button"
                onClick={() => setCommand(template.value)}
                className="aegis-chip transition-all duration-150 hover:-translate-y-0.5 hover:text-foreground"
                style={{ transitionDelay: `${index * 40}ms` }}
              >
                {template.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-foreground/8 bg-background/60 px-4 py-3">
            <label className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-foreground/40">
              LinkUp depth
            </label>
            <select
              value={linkupDepth}
              onChange={(event) => setLinkupDepth(event.target.value as LinkupDepth)}
              className="aegis-select min-w-44"
              disabled={isRunning || offlinePublicEnforced}
            >
              <option value="standard">Standard</option>
              <option value="deep">Deep</option>
            </select>
            <span className="max-w-xl text-sm font-light leading-relaxed text-foreground/60">
              Use deep mode only when you explicitly want more external research depth.
            </span>
          </div>
        </div>
      </section>

      <div
        id="agent-input"
        className="grid min-h-0 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)]"
      >
        <div className="grid min-w-0 gap-4">
          <PanelFrame
            title="Intelligence Input"
            subtitle="Paste the email thread and any supporting context."
            status={<StatusBadge tone="info">{countWords(emailText)} email words</StatusBadge>}
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

          <PanelFrame
            title="Command"
            subtitle="Control the analytical objective and execution from a single surface."
            actionButton={
              <div className="flex flex-wrap gap-2">
                <AegisButton variant="ghost" onClick={clearWorkspace}>
                  Clear
                </AegisButton>
                <AegisButton onClick={() => void runAgent()} disabled={!canRunAgent || isRunning || offlinePublicEnforced}>
                  {isRunning ? "Running" : "Run Analysis"}
                </AegisButton>
              </div>
            }
          >
            <div className="grid gap-3">
              <div className="text-sm font-light text-foreground/60">Keyboard shortcut: `Ctrl/Cmd + Enter`</div>
              {stream ? (
                <div className="rounded-2xl border border-foreground/8 bg-background/60 px-4 py-3 text-sm text-foreground/60">
                  {stream}
                </div>
              ) : null}
            </div>
          </PanelFrame>
        </div>

        <div id="agent-output" className="min-w-0">
          <div
            className={cn(
              "grid min-w-0 gap-4 rounded-3xl border border-foreground/8 bg-surface/90 p-4 transition-all duration-300 md:p-5",
              isReady ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            )}
            style={{ transitionDelay: "120ms" }}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-foreground/8 pb-4">
              {["Plan", "Trust", "Research", "Output"].map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                    index === 0
                      ? "bg-foreground text-background"
                      : "text-foreground/40 hover:text-foreground/70"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="min-w-0 transition-all duration-300" style={{ transitionDelay: "160ms" }}>
                <PanelFrame
                  title="Plan"
                  subtitle="Structured execution steps before run output."
                  actionButton={
                    <AegisButton variant="ghost" onClick={() => setExpandedPlan((current) => !current)}>
                      {expandedPlan ? "Compact" : "Focus"}
                    </AegisButton>
                  }
                >
                  <PlanPanel plan={plan} stream={stream} expanded={expandedPlan} />
                </PanelFrame>
              </div>
              <div className="min-w-0 transition-all duration-300" style={{ transitionDelay: "220ms" }}>
                <PanelFrame
                  title="Trust"
                  subtitle="Ledger of local and model-driven actions."
                  actionButton={
                    <AegisButton variant="ghost" onClick={() => setExpandedLedger((current) => !current)}>
                      {expandedLedger ? "Compact" : "Focus"}
                    </AegisButton>
                  }
                >
                  <LedgerPanel ledger={ledger} expanded={expandedLedger} />
                </PanelFrame>
              </div>
              <div className="min-w-0 transition-all duration-300" style={{ transitionDelay: "280ms" }}>
                <PanelFrame
                  title="Research"
                  subtitle="Redacted search activity and evidence traces."
                  actionButton={
                    <AegisButton variant="ghost" onClick={() => setExpandedResearch((current) => !current)}>
                      {expandedResearch ? "Compact" : "Focus"}
                    </AegisButton>
                  }
                >
                  <ResearchPanel research={research} expanded={expandedResearch} />
                </PanelFrame>
              </div>
            </div>

            <div className="min-w-0 transition-all duration-300" style={{ transitionDelay: "340ms" }}>
              <PanelFrame title="Output" subtitle="Final structured report, evidence summary, and draft response.">
                <OutputPanel stream={stream} outputs={outputs} />
              </PanelFrame>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
