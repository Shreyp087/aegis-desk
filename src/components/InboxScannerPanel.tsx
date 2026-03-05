"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EscalateToHelpdeskButton } from "@/components/tickets/EscalateToHelpdeskButton";
import { TicketLinkForEmail } from "@/components/tickets/TicketLinkForEmail";

type Priority = "high" | "medium" | "low";
type Mode = "manual" | "gmail";
type Category =
  | "scam_bec"
  | "scam_invoice_fraud"
  | "scam_credential_phishing"
  | "scam_malware_attachment"
  | "scam_impersonation"
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general";

type TicketDecision = "escalate" | "quarantine";
type FeedbackOutcome =
  | "spam_true_positive"
  | "spam_false_positive"
  | "harmful_true_positive"
  | "harmful_false_positive"
  | "actionable_correct"
  | "informational_correct";

const FILTER_CATEGORIES = [
  "scam_bec",
  "scam_invoice_fraud",
  "scam_credential_phishing",
  "scam_malware_attachment",
  "scam_impersonation",
  "security_phishing",
  "finance_payment",
  "legal_contract",
  "deadline_scheduling",
  "executive_escalation",
  "newsletter",
] as const;

type VisibleCategory = (typeof FILTER_CATEGORIES)[number];
type Filter = "all" | "high" | "medium" | "low" | VisibleCategory;

type CategoryScore = {
  category: Category;
  score: number;
  reason: string;
};

type InboxAlert = {
  id: string;
  from: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  priorityScore: number;
  uncertaintyPercent: number;
  priority: Priority;
  primaryCategory: Category;
  mailClass?: "spam" | "harmful" | "actionable" | "informational";
  threatType?:
    | "phishing"
    | "impersonation"
    | "malware"
    | "payment_fraud"
    | "legal_risk"
    | "none"
    | "unknown";
  decisionTrace?: {
    policyVersion: string;
    modelVersion: string;
    explanation: string;
    evidenceRefs: Array<{ type: string; ref: string; weight: number }>;
  };
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  suggestedAction: string;
  draftReply: string;
  consensusScore: number;
  consensusNote: string;
  trustedDecision?: {
    action: "allow" | "escalate" | "quarantine" | "block";
    confidencePct: number;
    riskScore: number;
    note: string;
  };
  classifier?: {
    modelVersion: string;
    predictedClass: "spam" | "harmful" | "actionable" | "informational";
    probabilities: {
      spam: number;
      harmful: number;
      actionable: number;
      informational: number;
    };
    memorySampleCount: number;
    rationale: string;
  };
  guardrails?: {
    policyVersion: string;
    ruleHits: string[];
    rationale: string;
    priorityAdjusted: boolean;
    actionAdjusted: boolean;
    classificationAdjusted: boolean;
  };
  memoryRef?: {
    sourceHash: string;
    subjectHash: string;
    senderEmailHash: string;
  };
  trustScore: number;
  reputationScore: number;
  reputationFindings: string[];
  thread: {
    key: string;
    depth: number;
    riskDensity: number;
  };
  rawEmail: string;
  baseUncertaintyPercent: number;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
    attachmentRiskScore: number;
  };
};

type InboxMeta = {
  mode: string;
  processingMode?: "offline_enforced" | "hybrid_remote_llm";
  offlineState?: string;
  scanned: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  policyVersion?: string;
  modelVersion?: string;
  classifierVersion?: string;
  guardrailVersion?: string;
  learningSamplesUsed?: number;
  consensusMode?: "single" | "multi";
  consensusMaxModels?: number;
  consensusSource?: "env_default" | "admin_override";
};

type InboxResponse = {
  ok: true;
  alerts: InboxAlert[];
  meta: InboxMeta;
};

type GmailStatus = {
  connected: boolean;
  email: string | null;
};

type InboxConsensusSettings = {
  consensusEnabled: boolean;
  consensusMaxModels: number;
  source: "env_default" | "admin_override";
};

type InboxSettingsResponse = {
  ok: true;
  canEdit: boolean;
  settings: InboxConsensusSettings;
};

function categoryLabel(category: Category): string {
  const labels: Record<Category, string> = {
    scam_bec: "Scam BEC",
    scam_invoice_fraud: "Scam Invoice",
    scam_credential_phishing: "Scam Credential",
    scam_malware_attachment: "Scam Malware",
    scam_impersonation: "Scam Impersonation",
    security_phishing: "Security",
    finance_payment: "Finance",
    legal_contract: "Legal",
    deadline_scheduling: "Deadline",
    executive_escalation: "Executive",
    sales_marketing: "Sales",
    ops_support: "Support",
    newsletter: "Newsletter",
    general: "General",
  };
  return labels[category];
}

function splitManualEmails(input: string): string[] {
  return input
    .split(/\n-{3,}\n/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseDomains(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function domainFromEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

function suggestedCommand(alert: InboxAlert): string {
  if (alert.primaryCategory === "scam_bec" || alert.primaryCategory === "scam_impersonation") {
    return "Analyze this message for executive impersonation/BEC risk, verify sender identity with trusted sources, and draft a strict verification-only response.";
  }
  if (alert.primaryCategory === "scam_invoice_fraud" || alert.primaryCategory === "finance_payment") {
    return "Analyze this payment/invoice request for fraud indicators, verify account details with trusted sources, and draft a safe hold-and-verify response.";
  }
  if (alert.primaryCategory === "scam_credential_phishing" || alert.primaryCategory === "security_phishing") {
    return "Analyze this email for phishing/security risk, verify sender legitimacy with sources, and draft a safe verification-first response.";
  }
  if (alert.primaryCategory === "scam_malware_attachment") {
    return "Analyze this email for malware/attachment risk, recommend immediate containment steps, and draft a response that requests alternate secure file transfer.";
  }
  if (alert.primaryCategory === "legal_contract") {
    return "Summarize the legal request, identify contract risks, and draft a professional negotiation response with safer terms.";
  }
  if (alert.primaryCategory === "deadline_scheduling") {
    return "Extract deadlines and action items, identify execution risks, and draft a clear confirmation reply with next steps.";
  }
  return "Summarize this email, identify key risks and action items, and draft a concise professional reply.";
}

function toTicketDecision(alert: InboxAlert): TicketDecision {
  const action = alert.trustedDecision?.action || "escalate";
  if (action === "block" || action === "quarantine") return "quarantine";
  return "escalate";
}

function confidenceFromAlert(alert: InboxAlert): number {
  const pct = alert.trustedDecision?.confidencePct ?? alert.consensusScore;
  return Math.max(0, Math.min(1, Math.round(pct) / 100));
}

function riskSummaryFromAlert(alert: InboxAlert) {
  return {
    category: alert.primaryCategory,
    score: alert.priorityScore,
    deterministicNotes: alert.signals.slice(0, 6),
    llmSummary: alert.consensusNote || undefined,
  };
}

function safeFeedbackLabel(alert: InboxAlert): FeedbackOutcome {
  if (alert.mailClass === "spam") return "spam_false_positive";
  if (alert.mailClass === "harmful") return "harmful_false_positive";
  if (alert.mailClass === "actionable") return "actionable_correct";
  return "informational_correct";
}

function chipClass(active: boolean): string {
  return `text-xs px-3 py-1.5 rounded-full border transition-all shrink-0 ${
    active
      ? "bg-[rgba(71,215,255,0.28)] text-slate-100 border-cyan-300/70 shadow-[0_8px_18px_rgba(71,215,255,0.22)]"
      : "bg-[rgba(14,24,39,0.66)] text-slate-300 border-slate-400/30 hover:bg-[rgba(71,215,255,0.16)] hover:text-slate-100"
  }`;
}

function hasCategory(alert: InboxAlert, category: Category): boolean {
  if (alert.primaryCategory === category) return true;
  return alert.categoryScores.some((entry) => entry.category === category && entry.score >= 35);
}

export default function InboxScannerPanel({
  onEscalate,
}: {
  onEscalate: (rawEmail: string, escalatedCommand: string) => void;
}) {
  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || "disabled";
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";
  const offlinePublicEnforced = offlinePublicEnabled && offlinePublicState === "enforced";

  const [mode, setMode] = useState<Mode>("manual");
  const [rawInbox, setRawInbox] = useState("");
  const [orgDomainsInput, setOrgDomainsInput] = useState("");
  const [gmailQuery, setGmailQuery] = useState("in:inbox");
  const [gmailMaxResults, setGmailMaxResults] = useState(20);

  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ connected: false, email: null });
  const [checkingStatus, setCheckingStatus] = useState(false);

  const [alerts, setAlerts] = useState<InboxAlert[]>([]);
  const [meta, setMeta] = useState<InboxMeta | null>(null);
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreatedTicketId, setLastCreatedTicketId] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [canEditConsensus, setCanEditConsensus] = useState(false);
  const [consensusEnabled, setConsensusEnabled] = useState(false);
  const [consensusMaxModels, setConsensusMaxModels] = useState(3);
  const [consensusSource, setConsensusSource] = useState<"env_default" | "admin_override">("env_default");
  const [feedbackSavingById, setFeedbackSavingById] = useState<Record<string, boolean>>({});
  const [feedbackStatusById, setFeedbackStatusById] = useState<Record<string, string>>({});

  async function refreshGmailStatus() {
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/inbox/gmail/status", { cache: "no-store" });
      const data = (await res.json()) as Partial<GmailStatus>;
      setGmailStatus({
        connected: Boolean(data.connected),
        email: typeof data.email === "string" ? data.email : null,
      });
    } catch {
      setGmailStatus({ connected: false, email: null });
    } finally {
      setCheckingStatus(false);
    }
  }

  async function refreshInboxSettings() {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch("/api/inbox/settings", { cache: "no-store" });
      const data = (await res.json()) as Partial<InboxSettingsResponse> & {
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !data.settings) {
        throw new Error(data.detail || data.error || "Failed to load inbox settings.");
      }

      setCanEditConsensus(Boolean(data.canEdit));
      setConsensusEnabled(Boolean(data.settings.consensusEnabled));
      setConsensusMaxModels(Math.max(1, Math.min(8, Number(data.settings.consensusMaxModels) || 3)));
      setConsensusSource(data.settings.source || "env_default");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to load inbox settings.";
      setSettingsError(detail);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveInboxSettings() {
    if (!canEditConsensus) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const res = await fetch("/api/inbox/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consensusEnabled,
          consensusMaxModels: Math.max(1, Math.min(8, consensusMaxModels)),
        }),
      });

      const data = (await res.json()) as Partial<InboxSettingsResponse> & {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !data.settings) {
        throw new Error(data.detail || data.error || "Failed to save inbox settings.");
      }

      setConsensusEnabled(Boolean(data.settings.consensusEnabled));
      setConsensusMaxModels(Math.max(1, Math.min(8, Number(data.settings.consensusMaxModels) || 3)));
      setConsensusSource(data.settings.source || "admin_override");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to save inbox settings.";
      setSettingsError(detail);
    } finally {
      setSettingsSaving(false);
    }
  }

  useEffect(() => {
    void refreshGmailStatus();
    void refreshInboxSettings();
  }, []);

  async function scanInbox() {
    setError(null);

    if (mode === "manual" && splitManualEmails(rawInbox).length === 0) {
      setError("Paste one or more emails before scanning.");
      return;
    }
    if (mode === "gmail" && offlinePublicEnforced) {
      setError("Gmail mode is disabled while offline mode is enforced. Use Manual mode.");
      return;
    }
    if (mode === "gmail" && !gmailStatus.connected) {
      setError("Connect Gmail first.");
      return;
    }

    setIsScanning(true);
    try {
      const orgDomains = parseDomains(orgDomainsInput);
      const gmailDomain = domainFromEmail(gmailStatus.email);
      if (gmailDomain && !orgDomains.includes(gmailDomain)) orgDomains.push(gmailDomain);

      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          emails: mode === "manual" ? splitManualEmails(rawInbox) : [],
          gmail: mode === "gmail" ? { query: gmailQuery, maxResults: gmailMaxResults } : undefined,
          userContext: { orgDomains },
        }),
      });

      const data = (await res.json()) as Partial<InboxResponse> & {
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !Array.isArray(data.alerts) || !data.meta) {
        throw new Error(data.detail || data.error || "Scan failed.");
      }

      setAlerts(data.alerts);
      setMeta(data.meta);
      setExpandedId(data.alerts[0]?.id || null);
      setActiveFilter("all");
      setFeedbackSavingById({});
      setFeedbackStatusById({});
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Scan failed.";
      setError(detail);
    } finally {
      setIsScanning(false);
    }
  }

  async function disconnectGmail() {
    await fetch("/api/inbox/gmail/disconnect", { method: "POST" });
    await refreshGmailStatus();
  }

  async function submitFeedback(args: {
    alert: InboxAlert;
    outcomeLabel: FeedbackOutcome;
    correctedClass?: "spam" | "harmful" | "actionable" | "informational";
    correctedPriority?: "low" | "medium" | "high";
  }) {
    const sourceHash = args.alert.memoryRef?.sourceHash;
    if (!sourceHash) {
      setFeedbackStatusById((prev) => ({
        ...prev,
        [args.alert.id]: "Feedback unavailable for this result (missing memory reference).",
      }));
      return;
    }

    setFeedbackSavingById((prev) => ({ ...prev, [args.alert.id]: true }));
    try {
      const res = await fetch("/api/inbox/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceHash,
          sourceEmailId: args.alert.id,
          outcomeLabel: args.outcomeLabel,
          correctedClass: args.correctedClass,
          correctedPriority: args.correctedPriority,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        matched?: number;
        modified?: number;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "Failed to save feedback.");
      }

      const matched = Number(data.matched || 0);
      setFeedbackStatusById((prev) => ({
        ...prev,
        [args.alert.id]:
          matched > 0
            ? `Feedback saved (matched ${matched} memory record${matched === 1 ? "" : "s"}).`
            : "Feedback saved, but no matching memory records were found yet.",
      }));
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Feedback save failed.";
      setFeedbackStatusById((prev) => ({ ...prev, [args.alert.id]: detail }));
    } finally {
      setFeedbackSavingById((prev) => ({ ...prev, [args.alert.id]: false }));
    }
  }

  const counts = useMemo(() => {
    return {
      all: alerts.length,
      high: alerts.filter((a) => a.priority === "high").length,
      medium: alerts.filter((a) => a.priority === "medium").length,
      low: alerts.filter((a) => a.priority === "low").length,
      scam_bec: alerts.filter((a) => hasCategory(a, "scam_bec")).length,
      scam_invoice_fraud: alerts.filter((a) => hasCategory(a, "scam_invoice_fraud")).length,
      scam_credential_phishing: alerts.filter((a) => hasCategory(a, "scam_credential_phishing")).length,
      scam_malware_attachment: alerts.filter((a) => hasCategory(a, "scam_malware_attachment")).length,
      scam_impersonation: alerts.filter((a) => hasCategory(a, "scam_impersonation")).length,
      security_phishing: alerts.filter((a) => hasCategory(a, "security_phishing")).length,
      finance_payment: alerts.filter((a) => hasCategory(a, "finance_payment")).length,
      legal_contract: alerts.filter((a) => hasCategory(a, "legal_contract")).length,
      deadline_scheduling: alerts.filter((a) => hasCategory(a, "deadline_scheduling")).length,
      executive_escalation: alerts.filter((a) => hasCategory(a, "executive_escalation")).length,
      newsletter: alerts.filter((a) => hasCategory(a, "newsletter")).length,
    };
  }, [alerts]);

  const filtered = useMemo(() => {
    if (activeFilter === "all") return alerts;
    if (activeFilter === "high") return alerts.filter((a) => a.priority === "high");
    if (activeFilter === "medium") return alerts.filter((a) => a.priority === "medium");
    if (activeFilter === "low") return alerts.filter((a) => a.priority === "low");
    return alerts.filter((a) => hasCategory(a, activeFilter));
  }, [alerts, activeFilter]);

  const selected = alerts.find((a) => a.id === expandedId) || null;
  const summary = meta
    ? `Mode: ${meta.mode} | Processing: ${meta.processingMode || "hybrid_remote_llm"} | Offline: ${meta.offlineState || "disabled"} | Policy: ${meta.policyVersion || "n/a"} | Guardrails: ${meta.guardrailVersion || "n/a"} | Model: ${meta.modelVersion || "n/a"} | Classifier: ${meta.classifierVersion || "n/a"} | Consensus: ${meta.consensusMode || "single"}${meta.consensusMode === "multi" ? ` (${meta.consensusMaxModels || 1})` : ""} [${meta.consensusSource || "env_default"}] | Learning Signals: ${meta.learningSamplesUsed ?? 0} | Scanned: ${meta.scanned} | High: ${meta.highCount} | Medium: ${meta.mediumCount} | Low: ${meta.lowCount}`
    : "No scans yet.";

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 mobile-safe-pad">
      <div className="surface-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="font-semibold text-slate-100">Inbox Scanner</div>
          <button
            type="button"
            onClick={scanInbox}
            disabled={isScanning || checkingStatus}
            className="primary-cta px-3 py-2 rounded-lg font-semibold min-h-[40px] w-full sm:w-auto disabled:opacity-50"
          >
            {isScanning ? "Scanning..." : "Scan Inbox"}
          </button>
        </div>

        <div className="flex gap-2 mb-3 flex-wrap">
          <button className={chipClass(mode === "manual")} onClick={() => setMode("manual")}>
            Manual
          </button>
          <button
            className={chipClass(mode === "gmail")}
            onClick={() => setMode("gmail")}
            disabled={offlinePublicEnforced}
            title={offlinePublicEnforced ? "Gmail mode disabled in enforced offline mode." : "Use Gmail mode"}
          >
            Gmail
          </button>
        </div>

        <div className="surface-subcard p-3 mb-3 text-sm text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              Consensus mode:{" "}
              <span className="font-semibold">
                {consensusEnabled ? `Multi-model (${consensusMaxModels})` : "Single-model (cost saver)"}
              </span>{" "}
              <span className="opacity-80">[{consensusSource === "admin_override" ? "admin override" : "env default"}]</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshInboxSettings()}
              className="px-3 py-1.5 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[34px] text-xs"
              disabled={settingsLoading || settingsSaving}
            >
              {settingsLoading ? "Loading..." : "Refresh Settings"}
            </button>
          </div>

          {settingsLoading ? (
            <div className="mt-2 text-xs opacity-80">Loading consensus settings...</div>
          ) : canEditConsensus ? (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={consensusEnabled}
                  onChange={(e) => setConsensusEnabled(e.target.checked)}
                  disabled={settingsSaving || settingsLoading || offlinePublicEnforced}
                />
                Enable multi-model consensus
              </label>

              <input
                className="field-input text-xs w-full md:w-[140px]"
                type="number"
                min={1}
                max={8}
                value={consensusMaxModels}
                onChange={(e) => {
                  const n = Number(e.target.value) || 1;
                  setConsensusMaxModels(Math.max(1, Math.min(8, n)));
                }}
                disabled={!consensusEnabled || settingsSaving || settingsLoading || offlinePublicEnforced}
                title="Maximum models to run when consensus is enabled"
              />

              <button
                type="button"
                onClick={() => void saveInboxSettings()}
                disabled={settingsSaving || settingsLoading || offlinePublicEnforced}
                className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[36px] text-xs disabled:opacity-60"
              >
                {settingsSaving ? "Saving..." : "Save"}
              </button>
            </div>
          ) : (
            <div className="mt-2 text-xs opacity-80">
              Admin login is required to change consensus settings.
            </div>
          )}

          {settingsError ? <div className="text-xs text-rose-300 mt-2">{settingsError}</div> : null}
        </div>

        {offlinePublicEnforced ? (
          <div className="text-xs text-amber-200 mb-3">
            Enforced offline mode is active. Gmail fetch is disabled; use Manual mode.
          </div>
        ) : null}

        <div className="surface-subcard p-3 mb-3 text-sm text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="break-all">
              Gmail: {gmailStatus.connected ? "Connected" : "Not connected"}
              {gmailStatus.email ? ` (${gmailStatus.email})` : ""}
            </div>
            <div className="flex gap-2 flex-wrap">
              {!gmailStatus.connected ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/api/inbox/gmail/connect";
                  }}
                  className="px-3 py-1.5 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[38px]"
                >
                  Connect Gmail
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void disconnectGmail()}
                  className="px-3 py-1.5 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[38px]"
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={() => void refreshGmailStatus()}
                className="px-3 py-1.5 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[38px]"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {mode === "manual" ? (
          <textarea
            className="field-input h-48 sm:h-52 text-sm mb-3 resize-none"
            value={rawInbox}
            onChange={(e) => setRawInbox(e.target.value)}
            placeholder="Paste emails separated by ---"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            <input
              className="field-input text-sm"
              value={gmailQuery}
              onChange={(e) => setGmailQuery(e.target.value)}
              placeholder="Gmail query, e.g. in:inbox newer_than:30d"
            />
            <input
              className="field-input text-sm"
              type="number"
              min={1}
              max={50}
              value={gmailMaxResults}
              onChange={(e) => {
                const n = Number(e.target.value) || 20;
                setGmailMaxResults(Math.max(1, Math.min(50, n)));
              }}
              placeholder="Max emails (1-50)"
            />
          </div>
        )}

        <input
          className="field-input text-sm"
          value={orgDomainsInput}
          onChange={(e) => setOrgDomainsInput(e.target.value)}
          placeholder="Org domains (optional), e.g. yourcompany.com"
        />
        {error ? <div className="text-xs text-rose-300 mt-2">{error}</div> : null}
      </div>

      <div className="surface-card p-3">
        <div className="text-xs sm:text-sm text-slate-300 mb-2 break-words">{summary}</div>
        <div className="flex gap-2 overflow-x-auto pb-1 mobile-chip-scroll">
          <button className={chipClass(activeFilter === "all")} onClick={() => setActiveFilter("all")}>
            All ({counts.all})
          </button>
          <button className={chipClass(activeFilter === "high")} onClick={() => setActiveFilter("high")}>
            High ({counts.high})
          </button>
          <button className={chipClass(activeFilter === "medium")} onClick={() => setActiveFilter("medium")}>
            Medium ({counts.medium})
          </button>
          <button className={chipClass(activeFilter === "low")} onClick={() => setActiveFilter("low")}>
            Low ({counts.low})
          </button>
          {FILTER_CATEGORIES.map((category) => (
            <button
              key={category}
              className={chipClass(activeFilter === category)}
              onClick={() => setActiveFilter(category)}
            >
              {categoryLabel(category)} ({counts[category]})
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="min-h-0 overflow-auto surface-card max-h-none lg:max-h-96">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No emails in this category.</div>
          ) : (
            filtered.map((alert) => (
              <button
                key={alert.id}
                onClick={() => setExpandedId(alert.id)}
                className={`w-full text-left p-3 sm:p-4 border-b border-slate-400/20 hover:bg-cyan-400/10 ${
                  expandedId === alert.id ? "bg-cyan-400/15" : ""
                }`}
              >
                <div className="text-sm font-semibold text-slate-100 truncate">{alert.subject}</div>
                <div className="text-xs text-slate-400 truncate">{alert.senderEmail || alert.from}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                    {categoryLabel(alert.primaryCategory)}
                  </span>
                  {alert.mailClass ? (
                    <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10 uppercase">
                      {alert.mailClass}
                    </span>
                  ) : null}
                  {alert.threatType ? (
                    <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                      Threat {alert.threatType}
                    </span>
                  ) : null}
                  <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                    Priority {alert.priorityScore}
                  </span>
                  <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                    Uncertainty {alert.uncertaintyPercent}%
                  </span>
                  <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                    Consensus {alert.consensusScore}%
                  </span>
                  <span className="px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10 uppercase">
                    {alert.trustedDecision?.action || "escalate"}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="min-h-0 overflow-auto surface-card p-3 sm:p-4 max-h-none lg:max-h-96">
          {!selected ? (
            <div className="text-sm text-slate-400">Select an email to view details.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-100">{selected.subject}</div>
                <div className="text-sm text-slate-400">From: {selected.senderEmail || selected.from}</div>
                <div className="text-sm text-slate-400">Primary category: {categoryLabel(selected.primaryCategory)}</div>
                <div className="text-sm text-slate-300">
                  Trusted decision: {(selected.trustedDecision?.action || "escalate").toUpperCase()} (
                  {selected.trustedDecision?.riskScore ?? "-"}
                  /100 risk, {selected.trustedDecision?.confidencePct ?? "-"}% confidence)
                </div>
                <div className="mt-2">
                  <TicketLinkForEmail sourceEmailId={selected.id} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-400/25">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b border-slate-400/25 text-slate-300">
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Score</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.categoryScores.slice(0, 5).map((entry) => (
                      <tr key={entry.category} className="border-b border-slate-400/15 align-top">
                        <td className="py-2 px-3 text-slate-100">{categoryLabel(entry.category)}</td>
                        <td className="py-2 px-3 text-slate-100">{entry.score}</td>
                        <td className="py-2 px-3 text-slate-400">{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.riskTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selected.riskTags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-1 rounded-full border border-cyan-300/45 text-slate-200 bg-cyan-400/10">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                  Trust score: {selected.trustScore}/100
                </div>
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                  Reputation score: {selected.reputationScore}/100
                </div>
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                  Model consensus: {selected.consensusScore}% ({selected.consensusNote})
                </div>
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                  Thread depth: {selected.thread.depth} | Risk density: {selected.thread.riskDensity}
                </div>
                {selected.classifier ? (
                  <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                    Classifier ({selected.classifier.modelVersion}): {selected.classifier.predictedClass.toUpperCase()} | S/H/A/I{" "}
                    {Math.round(selected.classifier.probabilities.spam * 100)}/
                    {Math.round(selected.classifier.probabilities.harmful * 100)}/
                    {Math.round(selected.classifier.probabilities.actionable * 100)}/
                    {Math.round(selected.classifier.probabilities.informational * 100)} | Memory samples{" "}
                    {selected.classifier.memorySampleCount}
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2 text-xs text-slate-300">
                Decision note: {selected.trustedDecision?.note || "Decision note unavailable."}
              </div>
              {selected.guardrails ? (
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2 text-xs text-slate-300">
                  Guardrails ({selected.guardrails.policyVersion}):{" "}
                  {selected.guardrails.ruleHits.length > 0
                    ? selected.guardrails.ruleHits.join(", ")
                    : "none"}{" "}
                  | priority adjusted: {selected.guardrails.priorityAdjusted ? "yes" : "no"} | action adjusted:{" "}
                  {selected.guardrails.actionAdjusted ? "yes" : "no"} | class adjusted:{" "}
                  {selected.guardrails.classificationAdjusted ? "yes" : "no"}
                </div>
              ) : null}
              {selected.decisionTrace?.explanation ? (
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2 text-xs text-slate-300">
                  Decision trace: {selected.decisionTrace.explanation}
                </div>
              ) : null}

              {selected.extracted.attachments.length > 0 ? (
                <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2 text-xs text-slate-300">
                  Attachments ({selected.extracted.attachmentRiskScore}/100 risk):{" "}
                  {selected.extracted.attachments.join(", ")}
                </div>
              ) : null}

              {selected.reputationFindings.length > 0 ? (
                <ul className="text-xs text-slate-400 list-disc pl-5">
                  {selected.reputationFindings.map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
              ) : null}

              {selected.signals.length > 0 ? (
                <ul className="text-sm text-slate-300 list-disc pl-5">
                  {selected.signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              ) : null}

              <div className="text-sm text-slate-300">Suggested action: {selected.suggestedAction}</div>
              <pre className="text-sm whitespace-pre-wrap leading-relaxed text-slate-200 break-all">
                {selected.draftReply}
              </pre>

              <div className="rounded-lg border border-slate-400/25 bg-slate-900/30 p-2">
                <div className="text-xs text-slate-200 mb-2">
                  Learning feedback (updates memory for future scans)
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void submitFeedback({
                        alert: selected,
                        outcomeLabel: "spam_true_positive",
                        correctedClass: "spam",
                        correctedPriority: "low",
                      })
                    }
                    disabled={Boolean(feedbackSavingById[selected.id])}
                    className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[36px] text-xs disabled:opacity-60"
                  >
                    Confirm Spam
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void submitFeedback({
                        alert: selected,
                        outcomeLabel: "harmful_true_positive",
                        correctedClass: "harmful",
                        correctedPriority: "high",
                      })
                    }
                    disabled={Boolean(feedbackSavingById[selected.id])}
                    className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[36px] text-xs disabled:opacity-60"
                  >
                    Confirm Harmful
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void submitFeedback({
                        alert: selected,
                        outcomeLabel: safeFeedbackLabel(selected),
                        correctedClass:
                          selected.mailClass === "actionable"
                            ? "actionable"
                            : "informational",
                        correctedPriority:
                          selected.mailClass === "actionable" ? "medium" : "low",
                      })
                    }
                    disabled={Boolean(feedbackSavingById[selected.id])}
                    className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[36px] text-xs disabled:opacity-60"
                  >
                    Mark Safe
                  </button>
                </div>
                {feedbackStatusById[selected.id] ? (
                  <div className="text-xs text-slate-300 mt-2">{feedbackStatusById[selected.id]}</div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onEscalate(selected.rawEmail, suggestedCommand(selected))}
                  className="primary-cta px-3 py-2 rounded-lg font-semibold min-h-[40px] w-full sm:w-auto"
                >
                  Escalate to Main Agent
                </button>
                <EscalateToHelpdeskButton
                  sourceEmailId={selected.id}
                  sender={selected.senderEmail || selected.from}
                  subject={selected.subject}
                  date={new Date().toISOString()}
                  risk={riskSummaryFromAlert(selected)}
                  decision={toTicketDecision(selected)}
                  confidence={confidenceFromAlert(selected)}
                  onCreated={(localTicketId) => setLastCreatedTicketId(localTicketId)}
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(selected.rawEmail)}
                  className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[40px] w-full sm:w-auto"
                >
                  Copy Raw Email
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(selected.draftReply)}
                  className="px-3 py-2 rounded-lg border border-cyan-300/40 text-slate-200 hover:bg-cyan-400/15 transition min-h-[40px] w-full sm:w-auto"
                >
                  Copy Draft
                </button>
              </div>
              {lastCreatedTicketId ? (
                <Link href={`/tickets/${lastCreatedTicketId}`} className="text-xs text-cyan-200 underline">
                  Open newly created ticket: {lastCreatedTicketId}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
