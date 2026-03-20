import type { FormattedFinalOutput } from "@/lib/agent/finalFormatter";
import type { AgentEscalationScannerContext } from "@/lib/agent/prefill";

type PlanStep = {
  id?: string;
  type?: string;
  description?: string;
  desc?: string;
  reason?: string;
  title?: string;
};

type LedgerEvent = {
  type?: string;
  stepId?: string | number;
  message?: string;
  ts?: string | number;
  data?: unknown;
};

type ResearchEvent = {
  type?: string;
  message?: string;
  data?: unknown;
};

export type AnalysisReportExportPayload = {
  final: FormattedFinalOutput;
  plan?: unknown;
  ledger?: LedgerEvent[];
  research?: ResearchEvent[];
  emailText?: string;
  docText?: string;
  command?: string;
  scannerContext?: AgentEscalationScannerContext | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPercent(value: number, scale: "ratio" | "percent" = "ratio"): string {
  const normalized = scale === "ratio" ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function formatTimestamp(value?: string | number): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePlanSteps(plan: unknown): PlanStep[] {
  if (!plan || typeof plan !== "object") return [];
  const maybeSteps = (plan as { steps?: unknown }).steps;
  return Array.isArray(maybeSteps) ? (maybeSteps as PlanStep[]) : [];
}

function stringifyLines(values: string[] | undefined, empty = "None captured"): string {
  return values && values.length > 0 ? values.map((item) => escapeHtml(item)).join("</li><li>") : escapeHtml(empty);
}

function subjectSlug(value: string): string {
  const base = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "analysis-report";
}

function buildOverviewCards(payload: AnalysisReportExportPayload): string {
  const scanner = payload.scannerContext;
  const cards = [
    { label: "Final Action", value: payload.final.decision.final_action.replace(/_/g, " ") },
    { label: "Risk Level", value: `${payload.final.risk_assessment.level} · ${payload.final.risk_assessment.score}` },
    { label: "Uncertainty", value: `${payload.final.uncertainty.level} · ${formatPercent(payload.final.uncertainty.score)}` },
    { label: "Evidence Quality", value: formatPercent(payload.final.evidence_quality_score || 0) },
  ];

  if (scanner) {
    cards.push({ label: "Scanner Priority", value: `${scanner.priority} · ${scanner.priorityScore}` });
    cards.push({ label: "Scanner Route", value: scanner.decision?.final_action?.replace(/_/g, " ") || scanner.trustedDecision?.action || "n/a" });
  }

  return cards
    .map(
      (card) => `
        <div class="stat-card">
          <div class="stat-label">${escapeHtml(card.label)}</div>
          <div class="stat-value">${escapeHtml(card.value)}</div>
        </div>
      `
    )
    .join("");
}

function buildScannerSection(scanner?: AgentEscalationScannerContext | null): string {
  if (!scanner) return "";

  const deterministic = scanner.signalGroups?.deterministic
    ? escapeHtml(JSON.stringify(scanner.signalGroups.deterministic, null, 2))
    : "";
  const learned = scanner.signalGroups?.learned ? escapeHtml(JSON.stringify(scanner.signalGroups.learned, null, 2)) : "";

  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Inbox Scanner</div>
          <h2>Initial Triage Context</h2>
        </div>
        <div class="meta-pill">Captured ${escapeHtml(formatTimestamp(scanner.capturedAt))}</div>
      </div>
      <div class="meta-grid">
        <div><span>Subject</span><strong>${escapeHtml(scanner.subject || "-")}</strong></div>
        <div><span>Sender</span><strong>${escapeHtml(scanner.from || scanner.senderEmail || "-")}</strong></div>
        <div><span>Domain</span><strong>${escapeHtml(scanner.senderDomain || "-")}</strong></div>
        <div><span>Category</span><strong>${escapeHtml(scanner.primaryCategory || "-")}</strong></div>
        <div><span>Mail Class</span><strong>${escapeHtml(scanner.mailClass || "unknown")}</strong></div>
        <div><span>Threat Type</span><strong>${escapeHtml(scanner.threatType || "unknown")}</strong></div>
        <div><span>Priority</span><strong>${escapeHtml(`${scanner.priority} · ${scanner.priorityScore}`)}</strong></div>
        <div><span>Trust / Reputation</span><strong>${escapeHtml(`${scanner.trustScore} / ${scanner.reputationScore}`)}</strong></div>
        <div><span>Consensus</span><strong>${escapeHtml(`${scanner.consensusScore}%${typeof scanner.consensusStrength === "number" ? ` · ${formatPercent(scanner.consensusStrength)}` : ""}`)}</strong></div>
        <div><span>Uncertainty</span><strong>${escapeHtml(`${scanner.uncertaintyPercent}%${scanner.uncertainty ? ` · ${scanner.uncertainty.type.join(", ") || "none"}` : ""}`)}</strong></div>
        <div><span>Routing</span><strong>${escapeHtml(scanner.decision?.final_action || scanner.trustedDecision?.action || "n/a")}</strong></div>
        <div><span>Confidence</span><strong>${escapeHtml(String(scanner.trustedDecision?.confidencePct ?? scanner.consensusScore))}%</strong></div>
      </div>
      <div class="callout-grid two-up">
        <div class="callout-card">
          <div class="card-title">Explanation</div>
          <p>${escapeHtml(scanner.explanation?.summary || scanner.trustedDecision?.note || scanner.consensusNote || "No scanner explanation available.")}</p>
          <ul><li>${stringifyLines(scanner.explanation?.keyFactors || scanner.riskTags.slice(0, 5), "No scanner factors recorded")}</li></ul>
        </div>
        <div class="callout-card">
          <div class="card-title">Signals</div>
          <ul><li>${stringifyLines(scanner.signals.slice(0, 8), "No scanner signals recorded")}</li></ul>
          ${scanner.disagreementFlags.length > 0 ? `<div class="sub-meta">Disagreement flags: ${escapeHtml(scanner.disagreementFlags.join(", "))}</div>` : ""}
        </div>
      </div>
      ${deterministic || learned ? `
      <div class="code-grid two-up">
        ${deterministic ? `<div><div class="card-title">Deterministic Signal Groups</div><pre>${deterministic}</pre></div>` : ""}
        ${learned ? `<div><div class="card-title">Learned Signal Groups</div><pre>${learned}</pre></div>` : ""}
      </div>` : ""}
    </section>
  `;
}

function buildClaimsSection(final: FormattedFinalOutput): string {
  if (final.claims.length === 0) {
    return `<section class="section"><div class="section-header"><div><div class="eyebrow">Claims</div><h2>Structured Claims</h2></div></div><p class="muted-copy">No claims were extracted in the final synthesis.</p></section>`;
  }

  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Claims</div>
          <h2>Structured Claims</h2>
        </div>
      </div>
      <div class="stack">
        ${final.claims
          .map(
            (claim) => `
              <div class="detail-card">
                <div class="detail-head">
                  <span class="badge">${escapeHtml(claim.type.replace(/_/g, " "))}</span>
                  <span class="muted-copy">${escapeHtml(formatPercent(claim.confidence))} extraction confidence</span>
                  <span class="muted-copy">${escapeHtml(claim.verification?.status || "unverified")}</span>
                </div>
                <div class="detail-body">${escapeHtml(claim.text)}</div>
                <div class="detail-note">${escapeHtml(claim.verification?.notes || "No verification notes recorded.")}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function buildEvidenceSection(final: FormattedFinalOutput): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Research</div>
          <h2>Evidence & Conflicts</h2>
        </div>
        <div class="meta-pill">Quality ${escapeHtml(formatPercent(final.evidence_quality_score || 0))}</div>
      </div>
      ${final.conflicts.length > 0 ? `
        <div class="callout-card conflict-card">
          <div class="card-title">Conflicts</div>
          <ul><li>${stringifyLines(final.conflicts.map((conflict) => `${conflict.type}: ${conflict.summary}`), "No conflicts recorded")}</li></ul>
        </div>
      ` : ""}
      ${final.evidence.length > 0 ? `
        <div class="stack">
          ${final.evidence
            .map(
              (item) => `
                <div class="detail-card">
                  <div class="detail-head">
                    <span class="badge">${escapeHtml(formatPercent(item.relevance_score || 0))} relevance</span>
                    <span class="muted-copy">Source ${escapeHtml(formatPercent(item.source_quality_score || 0))}</span>
                    <span class="muted-copy">Recency ${escapeHtml(formatPercent(item.recency_score || 0))}</span>
                  </div>
                  <div class="detail-title">${escapeHtml(item.title || item.url || "Evidence item")}</div>
                  <div class="detail-body">${escapeHtml(item.snippet || "No excerpt captured.")}</div>
                  ${item.url ? `<div class="detail-note">${escapeHtml(item.url)}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      ` : `<p class="muted-copy">No external evidence was captured in this run.</p>`}
    </section>
  `;
}

function buildEntitySection(final: FormattedFinalOutput): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Trust</div>
          <h2>Entity Verification</h2>
        </div>
      </div>
      ${final.entityVerdicts.length > 0 ? `
        <div class="stack">
          ${final.entityVerdicts
            .map(
              (verdict) => `
                <div class="detail-card">
                  <div class="detail-head">
                    <span class="badge">${escapeHtml(verdict.verdict)}</span>
                    <span class="muted-copy">${escapeHtml(verdict.entityType)}</span>
                    <span class="muted-copy">${escapeHtml(String(verdict.uncertaintyPct))}% uncertainty</span>
                  </div>
                  <div class="detail-title">${escapeHtml(verdict.entity)}</div>
                  <div class="detail-body">${escapeHtml(verdict.rationale)}</div>
                  ${verdict.redFlags.length > 0 ? `<div class="detail-note">Red flags: ${escapeHtml(verdict.redFlags.join(", "))}</div>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      ` : `<p class="muted-copy">No entity verdicts were produced.</p>`}
    </section>
  `;
}

function buildAnalysisSection(final: FormattedFinalOutput): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Analysis</div>
          <h2>${escapeHtml(final.analysisSection?.title || "Key Findings")}</h2>
        </div>
      </div>
      ${(final.analysisSection?.findings || []).length > 0 ? `
        <div class="stack">
          ${final.analysisSection.findings
            .map(
              (finding) => `
                <div class="detail-card">
                  <div class="detail-head">
                    <span class="badge">${escapeHtml(finding.severity)}</span>
                  </div>
                  <div class="detail-title">${escapeHtml(finding.risk)}</div>
                  <div class="detail-body">${escapeHtml(finding.whyItMatters)}</div>
                  <div class="detail-note">Suggested edit: ${escapeHtml(finding.suggestedEdit)}</div>
                </div>
              `
            )
            .join("")}
        </div>
      ` : `<p class="muted-copy">No structured findings were generated.</p>`}
    </section>
  `;
}

function buildTraceSection(payload: AnalysisReportExportPayload): string {
  const planSteps = normalizePlanSteps(payload.plan);
  const ledger = payload.ledger || [];
  const research = payload.research || [];
  const final = payload.final;

  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Trace</div>
          <h2>Plan, Execution, and Audit Trail</h2>
        </div>
      </div>
      <div class="callout-grid two-up">
        <div class="callout-card">
          <div class="card-title">Planned Steps</div>
          ${planSteps.length > 0 ? `<ol class="ordered-list">${planSteps
            .map(
              (step) => `<li><strong>${escapeHtml(step.type || step.id || "step")}</strong> ${escapeHtml(step.description || step.desc || step.reason || step.title || "")}</li>`
            )
            .join("")}</ol>` : `<p class="muted-copy">No plan steps recorded.</p>`}
        </div>
        <div class="callout-card">
          <div class="card-title">Audit Trace</div>
          <ul><li>${stringifyLines(final.audit_trace.flags || [], "No audit flags recorded")}</li></ul>
          <div class="sub-meta">Models: ${escapeHtml((final.audit_trace.models_used || []).join(", ") || "Not recorded")}</div>
          <div class="sub-meta">Timestamps: ${escapeHtml((final.audit_trace.timestamps || []).join(" · ") || "Not recorded")}</div>
        </div>
      </div>
      <div class="code-grid two-up">
        <div>
          <div class="card-title">Ledger Events</div>
          <pre>${escapeHtml(JSON.stringify(ledger, null, 2) || "[]")}</pre>
        </div>
        <div>
          <div class="card-title">Research Events</div>
          <pre>${escapeHtml(JSON.stringify(research, null, 2) || "[]")}</pre>
        </div>
      </div>
    </section>
  `;
}

function buildInputsSection(payload: AnalysisReportExportPayload): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <div class="eyebrow">Appendix</div>
          <h2>Inputs and Generated Artifacts</h2>
        </div>
      </div>
      <div class="callout-grid two-up">
        <div class="callout-card">
          <div class="card-title">Command</div>
          <p>${escapeHtml(payload.command || "No command recorded.")}</p>
        </div>
        <div class="callout-card">
          <div class="card-title">Meeting Invite</div>
          <p><strong>${escapeHtml(payload.final.meetingInvite?.title || "-")}</strong></p>
          <p>${escapeHtml(payload.final.meetingInvite?.datetimeISO || "No time recorded")}</p>
          <pre>${escapeHtml(payload.final.meetingInvite?.ics || "No ICS artifact recorded.")}</pre>
        </div>
      </div>
      <div class="code-grid two-up">
        <div>
          <div class="card-title">Email Input</div>
          <pre>${escapeHtml(payload.emailText || "No email text recorded.")}</pre>
        </div>
        <div>
          <div class="card-title">Supporting Context</div>
          <pre>${escapeHtml(payload.docText || "No supporting context recorded.")}</pre>
        </div>
      </div>
      <div class="callout-card">
        <div class="card-title">Reply Draft</div>
        <pre>${escapeHtml(`Subject: ${payload.final.replyDraft?.subject || ""}\n\n${payload.final.replyDraft?.body || "No reply draft generated."}`)}</pre>
      </div>
    </section>
  `;
}

function buildReportHtml(payload: AnalysisReportExportPayload): string {
  const subject = payload.scannerContext?.subject || payload.final.summary.email || "Aegis Desk Report";
  const generatedAt = formatTimestamp(new Date().toISOString());

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #111827;
        --muted: #4b5563;
        --line: #d4d8df;
        --panel: #f8fafc;
        --panel-strong: #eef2f7;
        --accent: #1d4ed8;
        --accent-soft: rgba(29, 78, 216, 0.1);
        --risk: #b91c1c;
        --caution: #b45309;
        --clear: #047857;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #e5e7eb;
        color: var(--ink);
        font-family: "IBM Plex Sans", Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 18mm;
        background: white;
      }
      .report-header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: flex-start;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--line);
      }
      .brand { font-family: "IBM Plex Mono", monospace; letter-spacing: 0.18em; font-size: 11px; text-transform: uppercase; color: var(--muted); }
      h1 { margin: 10px 0 8px; font-size: 32px; line-height: 1.1; }
      .lede { margin: 0; font-size: 15px; line-height: 1.7; color: var(--muted); max-width: 70ch; }
      .meta-pill { display: inline-flex; align-items: center; border: 1px solid var(--line); padding: 6px 10px; border-radius: 999px; background: var(--panel); font-size: 11px; color: var(--muted); }
      .overview-grid, .meta-grid, .callout-grid, .code-grid {
        display: grid;
        gap: 14px;
      }
      .overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; }
      .meta-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .two-up { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat-card, .callout-card, .detail-card {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 16px;
        padding: 14px 16px;
      }
      .stat-label, .eyebrow, .card-title, .sub-meta {
        font-family: "IBM Plex Mono", monospace;
      }
      .stat-label, .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; color: var(--muted); }
      .stat-value { margin-top: 10px; font-size: 24px; line-height: 1.2; font-weight: 500; }
      .section { margin-top: 24px; }
      .section-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
      .section-header h2 { margin: 6px 0 0; font-size: 20px; line-height: 1.2; }
      .stack { display: grid; gap: 12px; }
      .detail-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .badge {
        display: inline-flex;
        border-radius: 999px;
        background: var(--accent-soft);
        border: 1px solid rgba(29, 78, 216, 0.18);
        color: var(--accent);
        padding: 4px 8px;
        font-size: 11px;
        font-family: "IBM Plex Mono", monospace;
        text-transform: uppercase;
      }
      .detail-title { margin-top: 10px; font-size: 15px; font-weight: 500; }
      .detail-body, .callout-card p, .muted-copy { margin-top: 10px; font-size: 14px; line-height: 1.75; color: var(--muted); }
      .detail-note, .sub-meta { margin-top: 10px; font-size: 12px; line-height: 1.6; color: var(--muted); }
      .card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
      .ordered-list, ul { margin: 12px 0 0; padding-left: 18px; }
      li { margin-bottom: 6px; font-size: 13px; line-height: 1.7; color: var(--muted); }
      .meta-grid div { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; background: white; }
      .meta-grid span { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
      .meta-grid strong { display: block; margin-top: 6px; font-size: 14px; font-weight: 500; color: var(--ink); }
      pre {
        margin: 12px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid var(--line);
        background: #ffffff;
        border-radius: 14px;
        padding: 12px;
        font-size: 12px;
        line-height: 1.65;
        font-family: "IBM Plex Mono", monospace;
        color: #1f2937;
      }
      .conflict-card { background: #fef2f2; }
      .footer-note {
        margin-top: 24px;
        border-top: 1px solid var(--line);
        padding-top: 12px;
        font-size: 11px;
        color: var(--muted);
        font-family: "IBM Plex Mono", monospace;
      }
      @media print {
        body { background: white; }
        .page { margin: 0; width: auto; min-height: auto; padding: 14mm; }
      }
      @page { size: A4; margin: 12mm; }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="report-header">
        <div>
          <div class="brand">Aegis Desk / Structured Analysis Report</div>
          <h1>${escapeHtml(subject)}</h1>
          <p class="lede">This export captures the full structured analytical flow from inbox triage through final synthesis, including scanner context, claims, evidence scoring, decisioning, and trace metadata.</p>
        </div>
        <div class="meta-pill">Generated ${escapeHtml(generatedAt)}</div>
      </header>

      <section class="section">
        <div class="section-header">
          <div>
            <div class="eyebrow">Overview</div>
            <h2>Executive Snapshot</h2>
          </div>
        </div>
        <div class="overview-grid">
          ${buildOverviewCards(payload)}
        </div>
        <div class="callout-grid two-up" style="margin-top: 14px;">
          <div class="callout-card">
            <div class="card-title">Summary</div>
            <p>${escapeHtml(payload.final.summary.email || "No email summary generated.")}</p>
            ${payload.final.summary.document ? `<p>${escapeHtml(payload.final.summary.document)}</p>` : ""}
          </div>
          <div class="callout-card">
            <div class="card-title">Decision & Uncertainty</div>
            <p>${escapeHtml(payload.final.decision.reason)}</p>
            <div class="sub-meta">${escapeHtml(payload.final.uncertainty.summary)}</div>
            ${(payload.final.summary.deadlines || []).length > 0 ? `<div class="sub-meta">Deadlines: ${escapeHtml(payload.final.summary.deadlines.join(", "))}</div>` : ""}
            ${(payload.final.summary.entities || []).length > 0 ? `<div class="sub-meta">Entities: ${escapeHtml(payload.final.summary.entities.join(", "))}</div>` : ""}
          </div>
        </div>
      </section>

      ${buildScannerSection(payload.scannerContext)}
      ${buildClaimsSection(payload.final)}
      ${buildEvidenceSection(payload.final)}
      ${buildEntitySection(payload.final)}
      ${buildAnalysisSection(payload.final)}
      ${buildTraceSection(payload)}
      ${buildInputsSection(payload)}

      <div class="footer-note">Prepared from the structured Aegis Desk workflow. Save via the browser print dialog as PDF for distribution.</div>
    </div>
    <script>
      window.addEventListener('load', () => {
        setTimeout(() => {
          window.focus();
          window.print();
        }, 180);
      });
      window.addEventListener('afterprint', () => {
        window.close();
      });
    </script>
  </body>
</html>`;
}

export function exportStructuredReportPdf(payload: AnalysisReportExportPayload) {
  if (typeof window === "undefined") return;

  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for this site to export the PDF report.");
  }

  popup.document.open();
  popup.document.write(buildReportHtml(payload));
  popup.document.close();
  popup.document.title = `${subjectSlug(payload.scannerContext?.subject || payload.final.summary.email || "analysis-report")}.pdf`;
}
