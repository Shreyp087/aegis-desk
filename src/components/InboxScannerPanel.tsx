"use client";

import { useEffect, useMemo, useState } from "react";

type ParsedEmail = {
  id: string;
  raw: string;

  from: string;
  fromEmail: string;
  fromDomain: string;

  to?: string;
  subject: string;
  date?: string;

  body: string;

  tags: string[]; // e.g. ["risk", "legal", "finance"]
  priority: "high" | "medium" | "low";
  riskScore: number; // 0-100
  reasons: string[];
  deadlines: string[]; // extracted phrases
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

function extractEmailAddress(fromLine: string) {
  const m = fromLine.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function extractDomain(email: string) {
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).toLowerCase();
}

function parseOneEmail(raw: string): Omit<ParsedEmail, "id" | "tags" | "priority" | "riskScore" | "reasons" | "deadlines"> {
  const lines = raw.split(/\r?\n/);

  const fromLine = lines.find((l) => l.toLowerCase().startsWith("from:")) || "";
  const toLine = lines.find((l) => l.toLowerCase().startsWith("to:")) || "";
  const subjectLine = lines.find((l) => l.toLowerCase().startsWith("subject:")) || "";
  const dateLine = lines.find((l) => l.toLowerCase().startsWith("date:")) || "";

  const from = fromLine.replace(/^from:\s*/i, "").trim();
  const to = toLine.replace(/^to:\s*/i, "").trim();
  const subject = subjectLine.replace(/^subject:\s*/i, "").trim() || "(No subject)";
  const date = dateLine.replace(/^date:\s*/i, "").trim();

  // Body: everything after "Body:" if present, else after headers
  const bodyIdx = lines.findIndex((l) => l.toLowerCase().startsWith("body:"));
  let body = "";
  if (bodyIdx !== -1) {
    body = lines.slice(bodyIdx + 1).join("\n").trim();
  } else {
    // fallback: drop header-ish lines at top
    body = lines
      .filter((l) => !/^(from:|to:|subject:|date:)\s*/i.test(l))
      .join("\n")
      .trim();
  }

  const fromEmail = extractEmailAddress(from);
  const fromDomain = extractDomain(fromEmail);

  return {
    raw,
    from,
    fromEmail,
    fromDomain,
    to,
    subject,
    date,
    body,
  };
}

/** Lightweight deadline extraction (demo-safe) */
function extractDeadlines(text: string): string[] {
  const t = text || "";
  const patterns = [
    /\bby\s+(eod|end of day|tomorrow|today|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/gi,
    /\bwithin\s+(\d+)\s*(hours|days)\b/gi,
    /\b(deadline|due)\s*[:\-]?\s*(.*)$/gim,
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
    /\b(\d{4}-\d{2}-\d{2})\b/g,
  ];
  const hits = new Set<string>();
  for (const p of patterns) {
    let m;
    while ((m = p.exec(t)) !== null) {
      const s = (m[0] || "").trim();
      if (s.length >= 6 && s.length <= 80) hits.add(s);
      if (hits.size >= 6) break;
    }
    if (hits.size >= 6) break;
  }
  return Array.from(hits);
}

function scoreEmail(raw: { subject: string; body: string; fromDomain: string; fromEmail: string }) {
  const subject = safeLower(raw.subject);
  const body = safeLower(raw.body);
  const fromDomain = safeLower(raw.fromDomain);

  const tags = new Set<string>();
  const reasons: string[] = [];

  // Signals
  const riskSignals = [
    { re: /\burgent\b|\bimmediate\b|\bfinal notice\b|\baction required\b/, reason: "Urgency pressure language" },
    { re: /\bwire\b|\bbank\b|\baccount number\b|\bpayment\b|\binvoice\b/, reason: "Payment / wire language" },
    { re: /\breset\b|\bpassword\b|\blogin\b|\bverify your account\b|\bsecurity alert\b/, reason: "Account/security action language" },
    { re: /\bconfidential\b|\bnda\b|\bindemnif/i, reason: "Legal / contract language" },
    { re: /\bclick here\b|\bdownload\b|\battached\b|\blink\b/, reason: "Link/attachment call-to-action" },
  ];

  const financeSignals = /\binvoice\b|\bpayment\b|\bwire\b|\bnet-?30\b|\brefund\b/;
  const legalSignals = /\bagreement\b|\bcontract\b|\bnda\b|\bliability\b|\bindemnif\b|\bgoverning law\b/;
  const securitySignals = /\bsecurity\b|\bpassword\b|\blogin\b|\bmfa\b|\bbreach\b|\balert\b/;

  // Domain trust heuristics (NOT a verdict, just triage)
  const suspiciousDomain = (() => {
    if (!fromDomain) return true;
    const badTlds = [".ru", ".xyz", ".top", ".click"];
    if (badTlds.some((t) => fromDomain.endsWith(t))) return true;
    // Looks like brand spoofing? (very light)
    if (fromDomain.includes("company-reset") || fromDomain.includes("secure-update")) return true;
    return false;
  })();

  let score = 10;

  for (const s of riskSignals) {
    if (s.re.test(subject) || s.re.test(body)) {
      score += 18;
      reasons.push(s.reason);
    }
  }

  if (financeSignals.test(subject) || financeSignals.test(body)) {
    tags.add("finance");
    score += 10;
  }
  if (legalSignals.test(subject) || legalSignals.test(body)) {
    tags.add("legal");
    score += 8;
  }
  if (securitySignals.test(subject) || securitySignals.test(body)) {
    tags.add("security");
    score += 12;
  }

  if (suspiciousDomain) {
    tags.add("risk");
    score += 12;
    reasons.push("Sender domain looks unusual / hard to verify");
  }

  // priority rules
  let priority: "high" | "medium" | "low" = "low";
  if (score >= 55) priority = "high";
  else if (score >= 30) priority = "medium";

  // risk tag if overall score high
  if (score >= 45) tags.add("risk");

  // needs reply heuristic
  if (/\bplease\b|\bconfirm\b|\blet me know\b|\bcan you\b|\breview\b/.test(subject + " " + body)) {
    tags.add("needs_reply");
  }

  return {
    tags: Array.from(tags),
    priority,
    riskScore: Math.max(0, Math.min(100, score)),
    reasons: Array.from(new Set(reasons)).slice(0, 5),
  };
}

function suggestedCommandForEmail(e: ParsedEmail) {
  // If risky: propose verification steps
  if (e.tags.includes("risk") || e.tags.includes("security")) {
    return "Analyze this email for fraud/security risk. Identify red flags, verify sender/entity background using web evidence, extract deadlines, and draft the safest response requesting verification. If risky, propose a verification checklist.";
  }
  if (e.tags.includes("legal")) {
    return "Summarize what this email requests. Identify legal/contract risks, verify the company background with sources, and draft a professional reply proposing safe next steps.";
  }
  if (e.tags.includes("finance")) {
    return "Summarize what payment/action is requested. Assess fraud risk, verify vendor legitimacy with sources, extract deadlines, and draft a safe confirmation/verification reply.";
  }
  return "Summarize this email, extract action items/deadlines, and draft a concise reply. If the email mentions an entity, verify it with web sources.";
}

function loadSenderMemory(): Record<string, number> {
  try {
    const raw = localStorage.getItem("aegis_sender_memory");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSenderMemory(mem: Record<string, number>) {
  try {
    localStorage.setItem("aegis_sender_memory", JSON.stringify(mem));
  } catch {}
}

export default function InboxScannerPanel({
  onEscalate,
}: {
  onEscalate: (rawEmail: string, escalatedCommand: string) => void;
}) {
  const [rawInbox, setRawInbox] = useState("");
  const [emails, setEmails] = useState<ParsedEmail[]>([]);
  const [activeFilter, setActiveFilter] = useState<
    "all" | "high" | "risk" | "needs_reply" | "finance" | "legal" | "security" | "other"
  >("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [senderMemory, setSenderMemory] = useState<Record<string, number>>({});

  useEffect(() => {
    setSenderMemory(loadSenderMemory());
  }, []);

  function scan() {
    const blocks = rawInbox
      .split(/\n-{3,}\n/g) // separator: ---
      .map((b) => b.trim())
      .filter(Boolean);

    const parsed: ParsedEmail[] = blocks.map((raw) => {
      const base = parseOneEmail(raw);
      const deadlines = extractDeadlines(base.subject + "\n" + base.body);
      const scored = scoreEmail({
        subject: base.subject,
        body: base.body,
        fromDomain: base.fromDomain,
        fromEmail: base.fromEmail,
      });

      return {
        id: uid(),
        raw,
        ...base,
        deadlines,
        ...scored,
      };
    });

    // Update repeat sender memory
    const nextMem = { ...senderMemory };
    for (const e of parsed) {
      const key = (e.fromEmail || e.from || "").toLowerCase();
      if (!key) continue;
      nextMem[key] = (nextMem[key] || 0) + 1;
    }
    setSenderMemory(nextMem);
    saveSenderMemory(nextMem);

    // Sort by priority, then riskScore
    parsed.sort((a, b) => {
      const p = (x: ParsedEmail) => (x.priority === "high" ? 2 : x.priority === "medium" ? 1 : 0);
      return p(b) - p(a) || b.riskScore - a.riskScore;
    });

    setEmails(parsed);
    setExpandedId(parsed[0]?.id || null);
    setActiveFilter("all");
  }

  const counts = useMemo(() => {
    const c = {
      all: emails.length,
      high: emails.filter((e) => e.priority === "high").length,
      risk: emails.filter((e) => e.tags.includes("risk")).length,
      needs_reply: emails.filter((e) => e.tags.includes("needs_reply")).length,
      finance: emails.filter((e) => e.tags.includes("finance")).length,
      legal: emails.filter((e) => e.tags.includes("legal")).length,
      security: emails.filter((e) => e.tags.includes("security")).length,
      other: emails.filter(
        (e) =>
          !e.tags.includes("risk") &&
          !e.tags.includes("finance") &&
          !e.tags.includes("legal") &&
          !e.tags.includes("security") &&
          !e.tags.includes("needs_reply")
      ).length,
    };
    return c;
  }, [emails]);

  const alerts = useMemo(() => {
    const risky = counts.risk;
    const high = counts.high;
    const deadline = emails.filter((e) => e.deadlines.length > 0).length;
    const repeats = Object.values(senderMemory).filter((n) => n >= 2).length;

    const list: string[] = [];
    if (high > 0) list.push(`🔴 ${high} high-priority`);
    if (risky > 0) list.push(`⚠️ ${risky} risky`);
    if (deadline > 0) list.push(`⏰ ${deadline} with deadlines`);
    if (repeats > 0) list.push(`🔁 ${repeats} repeat senders`);

    return list;
  }, [counts, emails, senderMemory]);

  const filtered = useMemo(() => {
    if (activeFilter === "all") return emails;
    if (activeFilter === "high") return emails.filter((e) => e.priority === "high");
    if (activeFilter === "risk") return emails.filter((e) => e.tags.includes("risk"));
    if (activeFilter === "needs_reply") return emails.filter((e) => e.tags.includes("needs_reply"));
    if (activeFilter === "finance") return emails.filter((e) => e.tags.includes("finance"));
    if (activeFilter === "legal") return emails.filter((e) => e.tags.includes("legal"));
    if (activeFilter === "security") return emails.filter((e) => e.tags.includes("security"));
    return emails.filter(
      (e) =>
        !e.tags.includes("risk") &&
        !e.tags.includes("finance") &&
        !e.tags.includes("legal") &&
        !e.tags.includes("security") &&
        !e.tags.includes("needs_reply")
    );
  }, [emails, activeFilter]);

  function pillClass(active: boolean) {
    return `text-xs px-3 py-1 rounded-full border transition ${
      active
        ? "bg-white text-black border-white"
        : "bg-neutral-950 text-neutral-200 border-neutral-800 hover:bg-neutral-900"
    }`;
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* Input */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="font-semibold">Inbox Scanner</div>
          <button
            type="button"
            onClick={scan}
            className="px-3 py-2 rounded-lg bg-white text-black font-semibold"
          >
            Scan Inbox
          </button>
        </div>

        <div className="text-sm text-neutral-400 mb-2">
          Paste multiple emails separated by <span className="text-neutral-200 font-mono">---</span>.
          The scanner will segment and highlight risk/priority.
        </div>

        <textarea
          className="w-full p-3 rounded-lg bg-neutral-900 border border-neutral-800 min-h-[150px] text-sm"
          value={rawInbox}
          onChange={(e) => setRawInbox(e.target.value)}
          placeholder={`From: alice@vendor.com
Subject: Invoice due
Date: ...

Body:
...

---
From: ...`}
        />
      </div>

      {/* Alerts + Filters */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-neutral-300">
            {emails.length === 0 ? (
              <span className="text-neutral-500">No emails scanned yet.</span>
            ) : (
              <>
                <span className="font-semibold">{emails.length}</span> emails •{" "}
                <span className="text-neutral-400">
                  {alerts.length ? alerts.join(" • ") : "No alerts"}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className={pillClass(activeFilter === "all")} onClick={() => setActiveFilter("all")}>
              All ({counts.all})
            </button>
            <button className={pillClass(activeFilter === "high")} onClick={() => setActiveFilter("high")}>
              High ({counts.high})
            </button>
            <button className={pillClass(activeFilter === "risk")} onClick={() => setActiveFilter("risk")}>
              Risky ({counts.risk})
            </button>
            <button
              className={pillClass(activeFilter === "needs_reply")}
              onClick={() => setActiveFilter("needs_reply")}
            >
              Needs Reply ({counts.needs_reply})
            </button>
            <button className={pillClass(activeFilter === "finance")} onClick={() => setActiveFilter("finance")}>
              Finance ({counts.finance})
            </button>
            <button className={pillClass(activeFilter === "legal")} onClick={() => setActiveFilter("legal")}>
              Legal ({counts.legal})
            </button>
            <button
              className={pillClass(activeFilter === "security")}
              onClick={() => setActiveFilter("security")}
            >
              Security ({counts.security})
            </button>
            <button className={pillClass(activeFilter === "other")} onClick={() => setActiveFilter("other")}>
              Other ({counts.other})
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left: list */}
        <div className="min-h-0 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No emails in this category.</div>
          ) : (
            filtered.map((e) => {
              const key = (e.fromEmail || e.from || "").toLowerCase();
              const seen = senderMemory[key] || 0;

              return (
                <button
                  key={e.id}
                  onClick={() => setExpandedId(e.id)}
                  className={`w-full text-left p-4 border-b border-neutral-800 hover:bg-neutral-900/40 transition ${
                    expandedId === e.id ? "bg-neutral-900/60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{e.subject}</div>
                      <div className="text-xs text-neutral-400 truncate">
                        {e.fromEmail || e.from} {e.date ? `• ${e.date}` : ""}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`text-xs px-2 py-1 rounded-full border ${
                          e.priority === "high"
                            ? "border-red-500/60 text-red-300"
                            : e.priority === "medium"
                            ? "border-yellow-500/60 text-yellow-300"
                            : "border-neutral-700 text-neutral-300"
                        }`}
                      >
                        {e.priority.toUpperCase()}
                      </span>

                      {e.tags.includes("risk") ? (
                        <span className="text-xs px-2 py-1 rounded-full border border-orange-500/60 text-orange-300">
                          RISK
                        </span>
                      ) : null}

                      {seen >= 2 ? (
                        <span className="text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-300">
                          REPEAT ×{seen}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {e.deadlines.length ? (
                    <div className="mt-2 text-xs text-neutral-300">
                      ⏰ {e.deadlines[0]}
                      {e.deadlines.length > 1 ? ` (+${e.deadlines.length - 1} more)` : ""}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {/* Right: detail */}
        <div className="min-h-0 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          {!expandedId ? (
            <div className="text-sm text-neutral-500">Select an email to view details.</div>
          ) : (
            (() => {
              const e = emails.find((x) => x.id === expandedId);
              if (!e) return <div className="text-sm text-neutral-500">Email not found.</div>;

              return (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-lg font-semibold">{e.subject}</div>
                    <div className="text-sm text-neutral-400 mt-1">
                      <div>From: {e.fromEmail || e.from}</div>
                      {e.to ? <div>To: {e.to}</div> : null}
                      {e.date ? <div>Date: {e.date}</div> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {e.tags.map((t) => (
                      <span key={t} className="text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-200">
                        {t}
                      </span>
                    ))}
                    <span className="text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-200">
                      riskScore: {e.riskScore}
                    </span>
                  </div>

                  {e.reasons.length ? (
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                      <div className="text-sm font-semibold mb-1">Why flagged</div>
                      <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
                        {e.reasons.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {e.deadlines.length ? (
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                      <div className="text-sm font-semibold mb-1">Deadlines detected</div>
                      <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
                        {e.deadlines.map((d, idx) => (
                          <li key={idx}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                    <div className="text-sm font-semibold mb-2">Email body</div>
                    <pre className="text-sm whitespace-pre-wrap leading-relaxed text-neutral-200">
                      {e.body || "(No body)"}
                    </pre>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onEscalate(e.raw, suggestedCommandForEmail(e))}
                      className="px-3 py-2 rounded-lg bg-white text-black font-semibold"
                    >
                      Escalate to Main Agent
                    </button>

                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(suggestedCommandForEmail(e))}
                      className="px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900 transition text-neutral-100"
                    >
                      Copy Suggested Command
                    </button>

                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(e.raw)}
                      className="px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900 transition text-neutral-100"
                    >
                      Copy Raw Email
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
