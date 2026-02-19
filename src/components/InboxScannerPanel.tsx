"use client";

import { useEffect, useMemo, useState } from "react";

type Priority = "high" | "medium" | "low";
type Mode = "manual" | "gmail";
type Category =
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general";

const FILTER_CATEGORIES = [
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
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  suggestedAction: string;
  draftReply: string;
  rawEmail: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
  };
};

type InboxMeta = {
  mode: string;
  scanned: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
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

function categoryLabel(category: Category): string {
  const labels: Record<Category, string> = {
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
  if (alert.primaryCategory === "security_phishing") {
    return "Analyze this email for phishing/security risk, verify sender legitimacy with sources, and draft a safe verification-first response.";
  }
  if (alert.primaryCategory === "finance_payment") {
    return "Analyze the payment request for fraud signals, verify vendor/account details with sources, and draft a cautious confirmation reply.";
  }
  if (alert.primaryCategory === "legal_contract") {
    return "Summarize the legal request, identify contract risks, and draft a professional negotiation response with safer terms.";
  }
  if (alert.primaryCategory === "deadline_scheduling") {
    return "Extract deadlines and action items, identify execution risks, and draft a clear confirmation reply with next steps.";
  }
  return "Summarize this email, identify key risks and action items, and draft a concise professional reply.";
}

function chipClass(active: boolean): string {
  return `text-xs px-3 py-1.5 rounded-full border transition-all ${
    active
      ? "bg-white text-black border-white shadow-lg shadow-white/20"
      : "bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white"
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

  useEffect(() => {
    void refreshGmailStatus();
  }, []);

  async function scanInbox() {
    setError(null);

    if (mode === "manual" && splitManualEmails(rawInbox).length === 0) {
      setError("Paste one or more emails before scanning.");
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

  const counts = useMemo(() => {
    return {
      all: alerts.length,
      high: alerts.filter((a) => a.priority === "high").length,
      medium: alerts.filter((a) => a.priority === "medium").length,
      low: alerts.filter((a) => a.priority === "low").length,
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
    ? `Mode: ${meta.mode} | Scanned: ${meta.scanned} | High: ${meta.highCount} | Medium: ${meta.mediumCount} | Low: ${meta.lowCount}`
    : "No scans yet.";

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="font-semibold">Inbox Scanner</div>
          <button
            type="button"
            onClick={scanInbox}
            disabled={isScanning || checkingStatus}
            className="px-3 py-2 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
          >
            {isScanning ? "Scanning..." : "Scan Inbox"}
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <button className={chipClass(mode === "manual")} onClick={() => setMode("manual")}>
            Manual
          </button>
          <button className={chipClass(mode === "gmail")} onClick={() => setMode("gmail")}>
            Gmail
          </button>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 mb-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              Gmail: {gmailStatus.connected ? "Connected" : "Not connected"}
              {gmailStatus.email ? ` (${gmailStatus.email})` : ""}
            </div>
            <div className="flex gap-2">
              {!gmailStatus.connected ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/api/inbox/gmail/connect";
                  }}
                  className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 transition"
                >
                  Connect Gmail
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void disconnectGmail()}
                  className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 transition"
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={() => void refreshGmailStatus()}
                className="px-3 py-1.5 rounded-lg border border-neutral-700 hover:bg-neutral-800 transition"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {mode === "manual" ? (
          <textarea
            className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-800 h-52 text-sm mb-3"
            value={rawInbox}
            onChange={(e) => setRawInbox(e.target.value)}
            placeholder="Paste emails separated by ---"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
            <input
              className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-sm"
              value={gmailQuery}
              onChange={(e) => setGmailQuery(e.target.value)}
              placeholder="Gmail query, e.g. in:inbox newer_than:30d"
            />
            <input
              className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-sm"
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
          className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-sm"
          value={orgDomainsInput}
          onChange={(e) => setOrgDomainsInput(e.target.value)}
          placeholder="Org domains (optional), e.g. yourcompany.com"
        />
        {error ? <div className="text-xs text-red-300 mt-2">{error}</div> : null}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="text-sm text-neutral-300 mb-2">{summary}</div>
        <div className="flex flex-wrap gap-2">
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
        <div className="min-h-0 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 max-h-96">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No emails in this category.</div>
          ) : (
            filtered.map((alert) => (
              <button
                key={alert.id}
                onClick={() => setExpandedId(alert.id)}
                className={`w-full text-left p-4 border-b border-neutral-800 hover:bg-neutral-900/40 ${
                  expandedId === alert.id ? "bg-neutral-900/60" : ""
                }`}
              >
                <div className="text-sm font-semibold truncate">{alert.subject}</div>
                <div className="text-xs text-neutral-400 truncate">{alert.senderEmail || alert.from}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full border border-neutral-700 text-neutral-300">
                    {categoryLabel(alert.primaryCategory)}
                  </span>
                  <span className="px-2 py-1 rounded-full border border-neutral-700 text-neutral-300">
                    Priority {alert.priorityScore}
                  </span>
                  <span className="px-2 py-1 rounded-full border border-neutral-700 text-neutral-300">
                    Uncertainty {alert.uncertaintyPercent}%
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="min-h-0 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 max-h-96">
          {!selected ? (
            <div className="text-sm text-neutral-500">Select an email to view details.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-lg font-semibold">{selected.subject}</div>
                <div className="text-sm text-neutral-400">From: {selected.senderEmail || selected.from}</div>
                <div className="text-sm text-neutral-400">Primary category: {categoryLabel(selected.primaryCategory)}</div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-neutral-800">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b border-neutral-800 text-neutral-400">
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Score</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.categoryScores.slice(0, 5).map((entry) => (
                      <tr key={entry.category} className="border-b border-neutral-900 align-top">
                        <td className="py-2 px-3 text-neutral-200">{categoryLabel(entry.category)}</td>
                        <td className="py-2 px-3 text-neutral-200">{entry.score}</td>
                        <td className="py-2 px-3 text-neutral-400">{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.riskTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selected.riskTags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-200">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              {selected.signals.length > 0 ? (
                <ul className="text-sm text-neutral-300 list-disc pl-5">
                  {selected.signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              ) : null}

              <div className="text-sm text-neutral-300">Suggested action: {selected.suggestedAction}</div>
              <pre className="text-sm whitespace-pre-wrap leading-relaxed text-neutral-200 break-all">
                {selected.draftReply}
              </pre>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onEscalate(selected.rawEmail, suggestedCommand(selected))}
                  className="px-3 py-2 rounded-lg bg-white text-black font-semibold"
                >
                  Escalate to Main Agent
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(selected.rawEmail)}
                  className="px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900 transition"
                >
                  Copy Raw Email
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(selected.draftReply)}
                  className="px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900 transition"
                >
                  Copy Draft
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
