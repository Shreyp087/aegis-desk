"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  InboxExplanation,
  InboxSignalGroups,
  InboxUncertainty,
} from "@/lib/inbox/compatibility";
import type { InboxDecision } from "@/lib/inbox/decision";

import PanelFrame from "@/components/PanelFrame";
import {
  AegisButton,
  EmptyState,
  InlineError,
  MetricCard,
  ProcessingBadge,
  StatusBadge,
  buttonClassName,
} from "@/components/ui/AegisPrimitives";
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
type PrimaryFilter = "all" | "high" | "pending" | "reviewed";

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
  signalGroups?: InboxSignalGroups;
  uncertainty?: InboxUncertainty;
  explanation?: InboxExplanation;
  decision?: InboxDecision;
  suggestedAction: string;
  draftReply: string;
  consensusScore: number;
  consensusNote: string;
  agreement_scores?: {
    label_agreement: number;
    action_agreement: number;
    confidence_variance: number;
    entity_overlap: number;
  };
  disagreement_flags?: string[];
  consensus_strength?: number;
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

type QuotedBlock = {
  kind: "quoted" | "body";
  text: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function humanizeFlag(value: string): string {
  return value.replace(/_/g, " ");
}

function splitManualEmails(input: string): string[] {
  return input
    .split(/\n-{3,}\n/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseDomains(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((value) => value.trim().toLowerCase())
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

function hasCategory(alert: InboxAlert, category: Category): boolean {
  if (alert.primaryCategory === category) return true;
  return alert.categoryScores.some((entry) => entry.category === category && entry.score >= 35);
}

function priorityTone(priority: Priority): "risk" | "caution" | "clear" {
  if (priority === "high") return "risk";
  if (priority === "medium") return "caution";
  return "clear";
}

function actionTone(action?: "allow" | "escalate" | "quarantine" | "block"): "risk" | "caution" | "clear" | "info" {
  if (action === "block" || action === "quarantine") return "risk";
  if (action === "escalate") return "caution";
  if (action === "allow") return "clear";
  return "info";
}

function mailClassTone(mailClass: InboxAlert["mailClass"]): "risk" | "caution" | "clear" | "info" | "muted" {
  if (mailClass === "harmful" || mailClass === "spam") return "risk";
  if (mailClass === "actionable") return "caution";
  if (mailClass === "informational") return "info";
  return "muted";
}

function buildBodyBlocks(rawEmail: string): QuotedBlock[] {
  return rawEmail
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((text) => ({
      kind: /^(>|on .+ wrote:|forwarded message|from:)/im.test(text) ? "quoted" : "body",
      text,
    }));
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/40">
      {children}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-xs uppercase tracking-[0.08em] text-aegis-dim">
        {label}
      </div>
      <div className="truncate text-sm text-aegis-muted">{value}</div>
    </div>
  );
}

function PrimaryFilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("aegis-chip transition-all duration-150 hover:-translate-y-0.5 hover:text-foreground", active && "aegis-chip-active")}
    >
      {label} · {count}
    </button>
  );
}

function CategoryFilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] transition-all duration-150 hover:-translate-y-0.5",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/10 bg-background/60 text-foreground/45 hover:border-foreground/20 hover:text-foreground/70"
      )}
    >
      {label} · {count}
    </button>
  );
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
  const [activeFilter, setActiveFilter] = useState<PrimaryFilter>("all");
  const [focusCategory, setFocusCategory] = useState<VisibleCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
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
  const [reviewedIds, setReviewedIds] = useState<Record<string, true>>({});
  const [archivedIds, setArchivedIds] = useState<Record<string, true>>({});
  const [manualReviewIds, setManualReviewIds] = useState<Record<string, true>>({});
  const [escalationNotes, setEscalationNotes] = useState<Record<string, string>>({});
  const [isReady, setIsReady] = useState(false);

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

  useEffect(() => {
    setIsReady(true);
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
      setFocusCategory("all");
      setSearchQuery("");
      setReviewedIds({});
      setArchivedIds({});
      setManualReviewIds({});
      setEscalationNotes({});
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
    const visibleAlerts = alerts.filter((alert) => !archivedIds[alert.id]);
    return {
      all: visibleAlerts.length,
      high: visibleAlerts.filter((alert) => alert.priority === "high").length,
      pending: visibleAlerts.filter((alert) => !reviewedIds[alert.id]).length,
      reviewed: visibleAlerts.filter((alert) => reviewedIds[alert.id]).length,
      scam_bec: visibleAlerts.filter((alert) => hasCategory(alert, "scam_bec")).length,
      scam_invoice_fraud: visibleAlerts.filter((alert) => hasCategory(alert, "scam_invoice_fraud")).length,
      scam_credential_phishing: visibleAlerts.filter((alert) => hasCategory(alert, "scam_credential_phishing")).length,
      scam_malware_attachment: visibleAlerts.filter((alert) => hasCategory(alert, "scam_malware_attachment")).length,
      scam_impersonation: visibleAlerts.filter((alert) => hasCategory(alert, "scam_impersonation")).length,
      security_phishing: visibleAlerts.filter((alert) => hasCategory(alert, "security_phishing")).length,
      finance_payment: visibleAlerts.filter((alert) => hasCategory(alert, "finance_payment")).length,
      legal_contract: visibleAlerts.filter((alert) => hasCategory(alert, "legal_contract")).length,
      deadline_scheduling: visibleAlerts.filter((alert) => hasCategory(alert, "deadline_scheduling")).length,
      executive_escalation: visibleAlerts.filter((alert) => hasCategory(alert, "executive_escalation")).length,
      newsletter: visibleAlerts.filter((alert) => hasCategory(alert, "newsletter")).length,
    };
  }, [alerts, archivedIds, reviewedIds]);

  const filtered = useMemo(() => {
    let next = alerts.filter((alert) => !archivedIds[alert.id]);

    if (activeFilter === "high") next = next.filter((alert) => alert.priority === "high");
    if (activeFilter === "pending") next = next.filter((alert) => !reviewedIds[alert.id]);
    if (activeFilter === "reviewed") next = next.filter((alert) => Boolean(reviewedIds[alert.id]));
    if (focusCategory !== "all") next = next.filter((alert) => hasCategory(alert, focusCategory));

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return next;

    return next.filter((alert) =>
      [alert.subject, alert.senderEmail, alert.from, alert.senderDomain, alert.rawEmail]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [activeFilter, alerts, archivedIds, focusCategory, reviewedIds, searchQuery]);

  const selected = alerts.find((alert) => alert.id === expandedId) || null;
  const selectedNote = selected ? escalationNotes[selected.id] || "" : "";
  const selectedBlocks = selected ? buildBodyBlocks(selected.rawEmail) : [];
  const selectedSignals = selected?.signalGroups?.deterministic.signals || selected?.signals || [];
  const selectedEvidenceItems = selected
    ? [
        {
          label: "Deadlines",
          count: selected.extracted.deadlines.length,
          detail: selected.extracted.deadlines[0] || "No due dates extracted.",
        },
        {
          label: "Money Mentions",
          count: selected.extracted.moneyMentions.length,
          detail: selected.extracted.moneyMentions[0] || "No payment language extracted.",
        },
        {
          label: "URLs",
          count: selected.extracted.urls.length,
          detail: selected.extracted.urls[0] || "No links extracted.",
        },
        {
          label: "Attachments",
          count: selected.extracted.attachments.length,
          detail: selected.extracted.attachments[0] || "No attachment names extracted.",
        },
      ]
    : [];

  const metaSummary = meta
    ? [
        `Mode ${meta.mode}`,
        `Processing ${meta.processingMode || "hybrid_remote_llm"}`,
        `Offline ${meta.offlineState || "disabled"}`,
        `Policy ${meta.policyVersion || "n/a"}`,
        `Guardrails ${meta.guardrailVersion || "n/a"}`,
        `Consensus ${meta.consensusMode || "single"}${
          meta.consensusMode === "multi" ? ` (${meta.consensusMaxModels || 1})` : ""
        }`,
      ]
    : [];

  function toggleReviewed(id: string) {
    setReviewedIds((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: true };
    });
  }

  function archiveAlert(id: string) {
    setArchivedIds((prev) => ({ ...prev, [id]: true }));
    if (expandedId === id) {
      const nextVisible = filtered.find((alert) => alert.id !== id);
      setExpandedId(nextVisible?.id || null);
    }
  }

  function flagManualReview(id: string) {
    setManualReviewIds((prev) => ({ ...prev, [id]: true }));
    setReviewedIds((prev) => ({ ...prev, [id]: true }));
  }

  function escalationCommandWithNote(alert: InboxAlert) {
    const note = (escalationNotes[alert.id] || "").trim();
    if (!note) return suggestedCommand(alert);
    return `${suggestedCommand(alert)}\n\nOperator note:\n${note}`;
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-4 transition-all duration-300",
        isReady ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <section
        id="scanner-controls"
        className="min-w-0 transition-all duration-300"
        style={{ transitionDelay: "0ms" }}
      >
        <PanelFrame
          title="Scan Control"
          subtitle="Choose source, confirm consensus behavior, and run a fresh queue scan."
          status={isScanning ? <ProcessingBadge label="Scanning" /> : <StatusBadge tone="muted">Ready</StatusBadge>}
          actionButton={
            <AegisButton onClick={() => void scanInbox()} disabled={isScanning || checkingStatus}>
              {isScanning ? "Scanning" : "Scan Inbox"}
            </AegisButton>
          }
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="grid min-w-0 gap-4">
              <div className="flex flex-wrap gap-2">
                <AegisButton
                  variant={mode === "manual" ? "primary" : "secondary"}
                  onClick={() => setMode("manual")}
                  className={cn("h-11 min-w-28 justify-center", mode === "manual" && "border border-foreground")}
                >
                  Manual
                </AegisButton>
                <AegisButton
                  variant={mode === "gmail" ? "primary" : "secondary"}
                  onClick={() => setMode("gmail")}
                  disabled={offlinePublicEnforced}
                  title={offlinePublicEnforced ? "Gmail mode is disabled while offline mode is enforced." : undefined}
                  className={cn("h-11 min-w-28 justify-center", mode === "gmail" && "border border-foreground")}
                >
                  Gmail
                </AegisButton>
              </div>

              {mode === "manual" ? (
                <div className="grid gap-2">
                  <SectionLabel>Manual Input</SectionLabel>
                  <textarea
                    className="aegis-input aegis-textarea aegis-textarea-data min-h-56"
                    value={rawInbox}
                    onChange={(event) => setRawInbox(event.target.value)}
                    placeholder="Paste one or more raw emails. Separate messages with --- on its own line."
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <SectionLabel>Gmail Query</SectionLabel>
                  <div className="grid min-h-56 content-start gap-4">
                    <input
                      aria-label="Gmail Query"
                      className="aegis-input min-h-14"
                      value={gmailQuery}
                      onChange={(event) => setGmailQuery(event.target.value)}
                      placeholder="in:inbox newer_than:7d"
                    />
                    <label className="grid max-w-56 gap-2">
                      <SectionLabel>Max Items</SectionLabel>
                      <input
                        aria-label="Max Items"
                        className="aegis-input min-h-14"
                        type="number"
                        min={1}
                        max={50}
                        value={gmailMaxResults}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value) || 20;
                          setGmailMaxResults(Math.max(1, Math.min(50, nextValue)));
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

              <label className="grid gap-2">
                <SectionLabel>Organization Domains</SectionLabel>
                <input
                  className="aegis-input min-h-14"
                  value={orgDomainsInput}
                  onChange={(event) => setOrgDomainsInput(event.target.value)}
                  placeholder="yourcompany.com, parentorg.com"
                />
              </label>

              {error ? <InlineError message={error} /> : null}

              {offlinePublicEnforced ? (
                <InlineError message="Enforced offline mode is active. Gmail fetch is disabled; use manual input." />
              ) : null}
            </div>

            <div className="grid w-full gap-4">
              <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SectionLabel>Gmail Connection</SectionLabel>
                    <div className="mt-2 text-sm text-aegis-text">
                      {gmailStatus.connected ? "Connected" : "Not connected"}
                    </div>
                    <div className="mt-1 break-all text-sm text-aegis-muted">
                      {gmailStatus.email || "Connect a Gmail account to scan live inbox messages."}
                    </div>
                  </div>
                  <StatusBadge tone={gmailStatus.connected ? "clear" : "muted"}>
                    {gmailStatus.connected ? "Connected" : "Idle"}
                  </StatusBadge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!gmailStatus.connected ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = "/api/inbox/gmail/connect";
                      }}
                      className={buttonClassName("secondary")}
                    >
                      Connect Gmail
                    </button>
                  ) : (
                    <button type="button" onClick={() => void disconnectGmail()} className={buttonClassName("ghost")}>
                      Disconnect
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void refreshGmailStatus()}
                    className={buttonClassName("secondary")}
                    disabled={checkingStatus}
                  >
                    {checkingStatus ? "Refreshing" : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SectionLabel>Consensus</SectionLabel>
                    <div className="mt-2 text-sm text-aegis-text">
                      {consensusEnabled ? `Multi-model (${consensusMaxModels})` : "Single-model"}
                    </div>
                    <div className="mt-1 text-sm text-aegis-muted">
                      Source: {consensusSource === "admin_override" ? "admin override" : "environment default"}
                    </div>
                  </div>
                  <StatusBadge tone={consensusEnabled ? "info" : "muted"}>
                    {settingsLoading ? "Loading" : consensusEnabled ? "Multi" : "Single"}
                  </StatusBadge>
                </div>

                {settingsLoading ? (
                  <div className="mt-4 text-sm text-aegis-muted">Loading settings…</div>
                ) : canEditConsensus ? (
                  <div className="mt-4 grid gap-3">
                    <label className="flex items-center gap-2 text-sm text-aegis-muted">
                      <input
                        type="checkbox"
                        checked={consensusEnabled}
                        onChange={(event) => setConsensusEnabled(event.target.checked)}
                        disabled={settingsSaving || offlinePublicEnforced}
                      />
                      Enable multi-model consensus
                    </label>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <input
                        className="aegis-input md:flex-1"
                        type="number"
                        min={1}
                        max={8}
                        value={consensusMaxModels}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value) || 1;
                          setConsensusMaxModels(Math.max(1, Math.min(8, nextValue)));
                        }}
                        disabled={!consensusEnabled || settingsSaving || offlinePublicEnforced}
                        title="Maximum models to run when consensus is enabled"
                      />
                      <div className="flex flex-wrap gap-2">
                        <AegisButton
                          variant="secondary"
                          onClick={() => void saveInboxSettings()}
                          disabled={settingsSaving || offlinePublicEnforced}
                        >
                          {settingsSaving ? "Saving" : "Save"}
                        </AegisButton>
                        <AegisButton variant="ghost" onClick={() => void refreshInboxSettings()} disabled={settingsSaving}>
                          Refresh
                        </AegisButton>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-aegis-muted">
                    Admin login is required to change consensus settings.
                  </div>
                )}

                {settingsError ? <InlineError className="mt-3" message={settingsError} /> : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <MetricCard label="Scanned" value={meta?.scanned ?? 0} sub="Current queue size." />
                <MetricCard
                  label="High Risk"
                  value={meta?.highCount ?? 0}
                  sub="Messages requiring fastest attention."
                  tone="risk"
                />
              </div>
            </div>
          </div>

          {metaSummary.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {metaSummary.map((item) => (
                <span
                  key={item}
                  className="rounded border border-aegis-border bg-aegis-elevated px-2.5 py-1 font-mono text-xs uppercase tracking-[0.06em] text-aegis-dim"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </PanelFrame>
      </section>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(280px,0.72fr)]">
        <section
          id="inbox-queue"
          className="min-h-0 min-w-0 transition-all duration-300 lg:col-span-1"
          style={{ transitionDelay: "120ms" }}
        >
          <PanelFrame
            title="Inbox Queue"
            subtitle="Search, filter, and select the next message to inspect."
            status={<StatusBadge tone="info">{filtered.length} visible</StatusBadge>}
          >
            <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={mode === "manual" ? "info" : "muted"}>Manual</StatusBadge>
                    <StatusBadge tone={mode === "gmail" ? "info" : "muted"}>Gmail</StatusBadge>
                  </div>
                  <StatusBadge tone={counts.high > 0 ? "risk" : "muted"}>{counts.high} high risk</StatusBadge>
                </div>

                <label className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-aegis-dim">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <input
                    className="aegis-input pl-9"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search sender, subject, domain, or raw text"
                  />
                </label>

                <div className="aegis-chip-row">
                  <PrimaryFilterButton active={activeFilter === "all"} label="All" count={counts.all} onClick={() => setActiveFilter("all")} />
                  <PrimaryFilterButton active={activeFilter === "high"} label="High Risk" count={counts.high} onClick={() => setActiveFilter("high")} />
                  <PrimaryFilterButton active={activeFilter === "pending"} label="Pending" count={counts.pending} onClick={() => setActiveFilter("pending")} />
                  <PrimaryFilterButton active={activeFilter === "reviewed"} label="Reviewed" count={counts.reviewed} onClick={() => setActiveFilter("reviewed")} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <CategoryFilterButton active={focusCategory === "all"} label="All Signals" count={counts.all} onClick={() => setFocusCategory("all")} />
                  {FILTER_CATEGORIES.map((category) => (
                    <CategoryFilterButton
                      key={category}
                      active={focusCategory === category}
                      label={categoryLabel(category)}
                      count={counts[category]}
                      onClick={() => setFocusCategory(category)}
                    />
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-auto rounded-lg border border-aegis-border bg-aegis-base">
                {isScanning ? (
                  <div className="grid gap-2 p-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="aegis-skeleton h-14 rounded-lg" />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <EmptyState
                    className="min-h-72"
                    icon={
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M3 7.5h18M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 0 7 7 7-7"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    }
                    title="No queue items for this view"
                    description="Run a scan or change the active filters to bring messages back into the queue."
                  />
                ) : (
                  filtered.map((alert, index) => {
                    const isSelected = expandedId === alert.id;
                    const isReviewed = Boolean(reviewedIds[alert.id]);
                    const needsManualReview = Boolean(manualReviewIds[alert.id]);
                    const rowTone = priorityTone(alert.priority);

                    return (
                      <button
                        key={alert.id}
                        type="button"
                        onClick={() => setExpandedId(alert.id)}
                        className={cn(
                          "aegis-table-row w-full border-l-2 px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg",
                          isReady ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                          isSelected && "aegis-row-selected",
                          isReviewed ? "aegis-row-read" : "aegis-row-unread",
                          "hover:bg-aegis-overlay",
                          rowTone === "risk" && "border-l-aegis-risk",
                          rowTone === "caution" && "border-l-aegis-caution",
                          rowTone === "clear" && "border-l-transparent"
                        )}
                        style={{ transitionDelay: `${index * 35}ms` }}
                      >
                        <div className="flex w-full items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-aegis-text">{alert.senderEmail || alert.from}</div>
                            <div className="mt-1 truncate text-sm text-aegis-text">{alert.subject}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <StatusBadge tone={priorityTone(alert.priority)}>{alert.priority.toUpperCase()}</StatusBadge>
                              <StatusBadge tone={mailClassTone(alert.mailClass)}>{(alert.mailClass || "queued").toUpperCase()}</StatusBadge>
                              {needsManualReview ? <StatusBadge tone="caution">MANUAL</StatusBadge> : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <div className="aegis-time">{alert.consensusScore}%</div>
                            <div className="text-xs text-aegis-dim">{alert.priorityScore} risk</div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </PanelFrame>
        </section>

        <section
          id="email-detail"
          className="min-h-0 min-w-0 transition-all duration-300 lg:col-span-1"
          style={{ transitionDelay: "180ms" }}
        >
          <PanelFrame
            title="Email Detail"
            subtitle="Inspect the selected thread, structured explanation, and raw message body."
            status={
              selected ? (
                <StatusBadge tone={selected.priority === "high" ? "risk" : selected.priority === "medium" ? "caution" : "clear"}>
                  {selected.priority.toUpperCase()}
                </StatusBadge>
              ) : undefined
            }
          >
            <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
              {!selected ? (
                <EmptyState
                  className="flex-1"
                  icon={
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M4 5h16v14H4zM8 9h8M8 13h5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  title="Select a message"
                  description="Choose a queue row to open the raw email, metadata, and structured signal summary."
                />
              ) : (
                <>
                  <div className="grid gap-2 border-b border-aegis-border pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xl leading-8 text-aegis-text">{selected.subject}</div>
                        <div className="mt-1 text-sm text-aegis-muted">{selected.senderEmail || selected.from}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone={actionTone(selected.trustedDecision?.action)}>{(selected.trustedDecision?.action || "escalate").toUpperCase()}</StatusBadge>
                        <StatusBadge tone={mailClassTone(selected.mailClass)}>{(selected.mailClass || "queued").toUpperCase()}</StatusBadge>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-3 md:grid-cols-3">
                      <MetaItem label="From" value={selected.senderEmail || selected.from || "Unknown sender"} />
                      <MetaItem label="Received" value="Unavailable in current scanner output" />
                      <MetaItem label="Thread Id" value={selected.thread.key || "Unavailable"} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 xl:flex-row">
                    <div className="grid min-w-0 flex-1 gap-4">
                      <div className="grid gap-2">
                        <SectionLabel>Message Body</SectionLabel>
                        <div className="max-h-96 overflow-auto rounded-lg border border-aegis-border bg-aegis-base px-4 py-4">
                          <div className="grid gap-3 font-mono text-sm leading-7 text-aegis-text">
                            {selectedBlocks.map((block, index) => (
                              <div
                                key={`${block.kind}-${index}`}
                                className={
                                  block.kind === "quoted"
                                    ? "rounded-lg border-l-2 border-aegis-border bg-aegis-elevated px-3 py-2 text-aegis-muted"
                                    : ""
                                }
                              >
                                <pre className="whitespace-pre-wrap break-words font-mono">{block.text}</pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <SectionLabel>Structured Explanation</SectionLabel>
                        <div className="rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                          <div className="text-sm leading-6 text-aegis-text">
                            {selected.explanation?.summary ||
                              selected.decisionTrace?.explanation ||
                              "No structured explanation was returned for this message."}
                          </div>
                          {selected.explanation?.keyFactors?.length ? (
                            <ul className="mt-3 grid gap-2">
                              {selected.explanation.keyFactors.slice(0, 5).map((factor) => (
                                <li
                                  key={factor}
                                  className="rounded border border-aegis-border bg-aegis-base px-3 py-2 text-sm text-aegis-muted"
                                >
                                  {factor}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="grid content-start gap-4 min-w-0">
                      <div className="grid gap-2">
                        <SectionLabel>Queue Metadata</SectionLabel>
                        <div className="grid gap-3 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                          <MetaItem label="Primary Category" value={categoryLabel(selected.primaryCategory)} />
                          <MetaItem
                            label="Trusted Decision"
                            value={`${selected.trustedDecision?.action || "escalate"} · ${
                              selected.trustedDecision?.confidencePct ?? selected.consensusScore
                            }% confidence`}
                          />
                          <MetaItem label="Thread Density" value={`${selected.thread.depth} depth · ${selected.thread.riskDensity} density`} />
                          <MetaItem label="Consensus" value={`${selected.consensusScore}%`} />
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <SectionLabel>Signals</SectionLabel>
                        <div className="grid gap-2 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                          {(selectedSignals.length > 0 ? selectedSignals : ["No deterministic signals captured."])
                            .slice(0, 5)
                            .map((signal: string) => (
                              <div key={signal} className="flex items-start gap-2 text-sm text-aegis-muted">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-aegis-info" />
                                <span>{signal}</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <SectionLabel>Evidence Extracts</SectionLabel>
                        <div className="grid gap-3 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {selectedEvidenceItems.map((item) => (
                              <div
                                key={item.label}
                                className="rounded-xl border border-aegis-border bg-aegis-base px-4 py-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-xs font-mono uppercase tracking-widest text-foreground/40">
                                      {item.label}
                                    </div>
                                    <div className="mt-2 text-sm leading-6 text-aegis-muted">{item.detail}</div>
                                  </div>
                                  <div className="shrink-0 text-2xl font-medium tracking-tight text-aegis-text">
                                    {item.count}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {selected.extracted.attachments.length > 0 ? (
                            <div className="rounded-xl border border-aegis-border bg-aegis-base px-4 py-4">
                              <div className="text-xs font-mono uppercase tracking-widest text-foreground/40">
                                Attachment Names
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {selected.extracted.attachments.map((attachment) => (
                                  <span
                                    key={attachment}
                                    className="rounded-full border border-aegis-border bg-aegis-elevated px-3 py-1.5 text-xs text-aegis-muted"
                                  >
                                    {attachment}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </PanelFrame>
        </section>

        <section
          id="triage-actions"
          className="min-h-0 min-w-0 transition-all duration-300 lg:col-span-2 xl:col-span-1"
          style={{ transitionDelay: "240ms" }}
        >
          <PanelFrame
            title="Triage Actions"
            subtitle="Route the selected message, annotate escalation, and record operator follow-through."
            status={selected ? <StatusBadge tone={priorityTone(selected.priority)}>{selected.priorityScore}/100</StatusBadge> : undefined}
          >
            <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
              {!selected ? (
                <EmptyState
                  className="flex-1"
                  icon={
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 3v18M3 12h18"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  title="No active message"
                  description="Pick a queue item to reveal risk routing, escalation actions, and follow-through controls."
                />
              ) : (
                <>
                  <div className="grid gap-4 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                    <SectionLabel>Risk Assessment</SectionLabel>
                    <div className="text-3xl leading-none text-aegis-text">
                      <span
                        className={
                          selected.priority === "high"
                            ? "text-aegis-risk"
                            : selected.priority === "medium"
                              ? "text-aegis-caution"
                              : "text-aegis-clear"
                        }
                      >
                        {selected.priorityScore}
                      </span>
                    </div>
                    <div
                      className={
                        selected.priority === "high"
                          ? "text-sm text-aegis-risk"
                          : selected.priority === "medium"
                            ? "text-sm text-aegis-caution"
                            : "text-sm text-aegis-clear"
                      }
                    >
                      {selected.priority.toUpperCase()} PRIORITY · {categoryLabel(selected.primaryCategory)}
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between text-xs text-aegis-dim">
                        <span>Confidence</span>
                        <span>{selected.trustedDecision?.confidencePct ?? selected.consensusScore}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-aegis-base">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-aegis-caution to-aegis-clear"
                          style={{ width: `${selected.trustedDecision?.confidencePct ?? selected.consensusScore}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 text-sm text-aegis-muted">
                      {(selectedSignals.length > 0 ? selectedSignals : selected.riskTags).slice(0, 4).map((signal: string) => (
                        <div key={signal} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-aegis-caution" />
                          <span>{signal}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                    <SectionLabel>Decision Routing</SectionLabel>
                    {selected.decision ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge tone={mailClassTone(selected.mailClass)}>{humanizeFlag(selected.decision.final_action).toUpperCase()}</StatusBadge>
                          <StatusBadge tone={selected.decision.risk_level === "high" ? "risk" : selected.decision.risk_level === "medium" ? "caution" : "clear"}>
                            {humanizeFlag(selected.decision.risk_level)}
                          </StatusBadge>
                        </div>
                        <div className="text-sm leading-6 text-aegis-muted">{selected.decision.reason}</div>
                      </>
                    ) : (
                      <div className="text-sm text-aegis-muted">Decision routing is unavailable for this result.</div>
                    )}

                    {selected.uncertainty ? (
                      <div className="grid gap-2 text-sm text-aegis-muted">
                        <div>Uncertainty score: {formatPercent(selected.uncertainty.score)}</div>
                        <div>
                          Types: {selected.uncertainty.type.length > 0 ? selected.uncertainty.type.map(humanizeFlag).join(", ") : "none"}
                        </div>
                        <div>
                          Sources: model {formatPercent(selected.uncertainty.sources.model_confidence)} · conflict {formatPercent(selected.uncertainty.sources.signal_conflict)} · missing {selected.uncertainty.sources.missing_fields}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    <button type="button" onClick={() => onEscalate(selected.rawEmail, escalationCommandWithNote(selected))} className={buttonClassName("primary", false, "justify-center")}>
                      Escalate to Agent Desk
                    </button>
                    <button type="button" onClick={() => toggleReviewed(selected.id)} className={buttonClassName("secondary", false, "justify-center")}>
                      {reviewedIds[selected.id] ? "Undo Reviewed" : "Mark Reviewed"}
                    </button>
                    <button type="button" onClick={() => archiveAlert(selected.id)} className={buttonClassName("ghost", false, "justify-center")}>
                      Archive / Skip
                    </button>
                    <button type="button" onClick={() => flagManualReview(selected.id)} className={buttonClassName("danger", false, "justify-center")}>
                      Flag for Manual Review
                    </button>
                  </div>

                  <div className="grid gap-2">
                    <SectionLabel>Escalation Note</SectionLabel>
                    <textarea
                      className="aegis-input aegis-textarea min-h-24"
                      placeholder="Optional analyst note to append to the escalation command."
                      value={selectedNote}
                      onChange={(event) => setEscalationNotes((prev) => ({ ...prev, [selected.id]: event.target.value }))}
                    />
                  </div>

                  <div className="grid gap-2 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                    <SectionLabel>Follow-through</SectionLabel>
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
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => navigator.clipboard.writeText(selected.rawEmail)} className={buttonClassName("secondary")}>
                        Copy Raw Email
                      </button>
                      <button type="button" onClick={() => navigator.clipboard.writeText(selected.draftReply)} className={buttonClassName("secondary")}>
                        Copy Draft
                      </button>
                    </div>
                    <TicketLinkForEmail sourceEmailId={selected.id} />
                    {lastCreatedTicketId ? (
                      <Link href={`/tickets/${lastCreatedTicketId}`} className="font-mono text-xs uppercase tracking-[0.08em] text-aegis-accent">
                        Open newly created ticket · {lastCreatedTicketId}
                      </Link>
                    ) : null}
                  </div>

                  <div className="grid gap-2 rounded-lg border border-aegis-border bg-aegis-elevated px-4 py-4">
                    <SectionLabel>Feedback Loop</SectionLabel>
                    <div className="grid gap-2">
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
                        className={buttonClassName("secondary", false, "justify-center")}
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
                        className={buttonClassName("secondary", false, "justify-center")}
                      >
                        Confirm Harmful
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void submitFeedback({
                            alert: selected,
                            outcomeLabel: safeFeedbackLabel(selected),
                            correctedClass: selected.mailClass === "actionable" ? "actionable" : "informational",
                            correctedPriority: selected.mailClass === "actionable" ? "medium" : "low",
                          })
                        }
                        disabled={Boolean(feedbackSavingById[selected.id])}
                        className={buttonClassName("ghost", false, "justify-center")}
                      >
                        Mark Safe
                      </button>
                    </div>
                    {feedbackStatusById[selected.id] ? <div className="text-sm text-aegis-muted">{feedbackStatusById[selected.id]}</div> : null}
                  </div>
                </>
              )}
            </div>
          </PanelFrame>
        </section>
      </div>
    </div>
  );
}

