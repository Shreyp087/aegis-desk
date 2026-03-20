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

type PdfState = {
  doc: import("jspdf").jsPDF;
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  marginY: number;
  width: number;
  y: number;
  subject: string;
  generatedAt: string;
};

const COLORS = {
  ink: [15, 23, 42] as const,
  muted: [71, 85, 105] as const,
  line: [203, 213, 225] as const,
  panel: [248, 250, 252] as const,
  panelStrong: [239, 246, 255] as const,
  accent: [29, 78, 216] as const,
  accentSoft: [219, 234, 254] as const,
  caution: [180, 83, 9] as const,
  danger: [185, 28, 28] as const,
  clear: [4, 120, 87] as const,
} as const;

function setColor(doc: import("jspdf").jsPDF, color: readonly [number, number, number]) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function setDrawColor(doc: import("jspdf").jsPDF, color: readonly [number, number, number]) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function setFillColor(doc: import("jspdf").jsPDF, color: readonly [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function subjectSlug(value: string): string {
  const base = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "analysis-report";
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

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function joinOrFallback(values: string[] | undefined, fallback = "None recorded"): string {
  return values && values.length > 0 ? values.join(", ") : fallback;
}

function splitText(doc: import("jspdf").jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text || "", width) as string[];
}

function lineHeight(fontSize: number, multiplier = 1.45): number {
  return fontSize * multiplier;
}

function pageHeader(state: PdfState) {
  const { doc, marginX, marginY, pageWidth, subject, generatedAt } = state;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, COLORS.muted);
  doc.text("AEGIS DESK / STRUCTURED ANALYSIS REPORT", marginX, marginY - 16);
  doc.setFont("helvetica", "normal");
  doc.text(generatedAt, pageWidth - marginX, marginY - 16, { align: "right" });
  setDrawColor(doc, COLORS.line);
  doc.line(marginX, marginY - 8, pageWidth - marginX, marginY - 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, COLORS.ink);
  const titleLines = splitText(doc, subject, state.width);
  doc.text(titleLines, marginX, marginY + 16);

  state.y = marginY + 16 + titleLines.length * lineHeight(22, 1.15) + 10;
}

function footer(state: PdfState) {
  const { doc, marginX, pageWidth, pageHeight } = state;
  const page = doc.getCurrentPageInfo().pageNumber;
  setDrawColor(doc, COLORS.line);
  doc.line(marginX, pageHeight - 26, pageWidth - marginX, pageHeight - 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, COLORS.muted);
  doc.text(`Page ${page}`, pageWidth - marginX, pageHeight - 12, { align: "right" });
  doc.text("Prepared from the Aegis Desk structured workflow.", marginX, pageHeight - 12);
}

function newPage(state: PdfState) {
  footer(state);
  state.doc.addPage();
  pageHeader(state);
}

function ensureSpace(state: PdfState, needed: number) {
  if (state.y + needed <= state.pageHeight - state.marginY - 28) return;
  newPage(state);
}

function sectionHeader(state: PdfState, label: string, title: string, subtitle?: string) {
  ensureSpace(state, subtitle ? 70 : 52);
  state.doc.setFont("helvetica", "bold");
  state.doc.setFontSize(10);
  setColor(state.doc, COLORS.accent);
  state.doc.text(label.toUpperCase(), state.marginX, state.y);

  state.doc.setFontSize(16);
  setColor(state.doc, COLORS.ink);
  state.doc.text(title, state.marginX, state.y + 16);

  if (subtitle) {
    state.doc.setFont("helvetica", "normal");
    state.doc.setFontSize(11);
    setColor(state.doc, COLORS.muted);
    const lines = splitText(state.doc, subtitle, state.width);
    state.doc.text(lines, state.marginX, state.y + 32);
    state.y += 32 + lines.length * lineHeight(11) + 6;
  } else {
    state.y += 28;
  }

  setDrawColor(state.doc, COLORS.line);
  state.doc.line(state.marginX, state.y, state.marginX + state.width, state.y);
  state.y += 14;
}

function paragraph(state: PdfState, text: string, opts?: { size?: number; color?: readonly [number, number, number]; bold?: boolean }) {
  const size = opts?.size ?? 11;
  const lines = splitText(state.doc, text || "", state.width);
  const height = lines.length * lineHeight(size) + 2;
  ensureSpace(state, height);
  state.doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  state.doc.setFontSize(size);
  setColor(state.doc, opts?.color ?? COLORS.muted);
  state.doc.text(lines, state.marginX, state.y);
  state.y += height;
}

function bullets(state: PdfState, items: string[], opts?: { color?: readonly [number, number, number] }) {
  const bulletItems = items.length > 0 ? items : ["None recorded."];
  for (const item of bulletItems) {
    const bulletX = state.marginX + 4;
    const textX = state.marginX + 14;
    const lines = splitText(state.doc, item, state.width - 14);
    const height = lines.length * lineHeight(11) + 4;
    ensureSpace(state, height);
    setFillColor(state.doc, COLORS.accent);
    state.doc.circle(bulletX, state.y - 4, 1.5, "F");
    state.doc.setFont("helvetica", "normal");
    state.doc.setFontSize(11);
    setColor(state.doc, opts?.color ?? COLORS.muted);
    state.doc.text(lines, textX, state.y);
    state.y += height;
  }
}

function keyValueGrid(state: PdfState, items: Array<{ label: string; value: string }>) {
  const gap = 12;
  const colWidth = (state.width - gap) / 2;
  const boxPadding = 10;

  for (let index = 0; index < items.length; index += 2) {
    const row = items.slice(index, index + 2);
    const heights = row.map((item) => {
      state.doc.setFont("helvetica", "bold");
      state.doc.setFontSize(11);
      const valueLines = splitText(state.doc, item.value, colWidth - boxPadding * 2);
      return 16 + valueLines.length * lineHeight(11) + 14;
    });
    const rowHeight = Math.max(...heights, 58);
    ensureSpace(state, rowHeight + 8);

    row.forEach((item, column) => {
      const x = state.marginX + column * (colWidth + gap);
      setFillColor(state.doc, COLORS.panel);
      setDrawColor(state.doc, COLORS.line);
      state.doc.roundedRect(x, state.y, colWidth, rowHeight, 8, 8, "FD");

      state.doc.setFont("helvetica", "bold");
      state.doc.setFontSize(9);
      setColor(state.doc, COLORS.muted);
      state.doc.text(item.label.toUpperCase(), x + boxPadding, state.y + 12);

      state.doc.setFont("helvetica", "normal");
      state.doc.setFontSize(11);
      setColor(state.doc, COLORS.ink);
      const valueLines = splitText(state.doc, item.value, colWidth - boxPadding * 2);
      state.doc.text(valueLines, x + boxPadding, state.y + 28);
    });

    state.y += rowHeight + 8;
  }
}

function metricCards(
  state: PdfState,
  items: Array<{ label: string; value: string; tone?: "risk" | "caution" | "clear" | "info"; sub?: string }>
) {
  const gap = 12;
  const cols = 2;
  const cardWidth = (state.width - gap) / cols;

  for (let index = 0; index < items.length; index += cols) {
    const row = items.slice(index, index + cols);
    const heights = row.map((item) => {
      state.doc.setFont("helvetica", "bold");
      state.doc.setFontSize(18);
      const valueLines = splitText(state.doc, item.value, cardWidth - 24);
      const subLines = item.sub ? splitText(state.doc, item.sub, cardWidth - 24) : [];
      return 44 + valueLines.length * lineHeight(18, 1.15) + subLines.length * lineHeight(10, 1.4);
    });
    const rowHeight = Math.max(...heights, 84);
    ensureSpace(state, rowHeight + 8);

    row.forEach((item, column) => {
      const x = state.marginX + column * (cardWidth + gap);
      setFillColor(state.doc, COLORS.panelStrong);
      setDrawColor(state.doc, COLORS.line);
      state.doc.roundedRect(x, state.y, cardWidth, rowHeight, 10, 10, "FD");

      state.doc.setFont("helvetica", "bold");
      state.doc.setFontSize(9);
      setColor(state.doc, COLORS.muted);
      state.doc.text(item.label.toUpperCase(), x + 12, state.y + 14);

      const toneColor =
        item.tone === "risk"
          ? COLORS.danger
          : item.tone === "caution"
            ? COLORS.caution
            : item.tone === "clear"
              ? COLORS.clear
              : COLORS.accent;
      state.doc.setFont("helvetica", "bold");
      state.doc.setFontSize(18);
      setColor(state.doc, toneColor);
      const valueLines = splitText(state.doc, item.value, cardWidth - 24);
      state.doc.text(valueLines, x + 12, state.y + 34);

      if (item.sub) {
        state.doc.setFont("helvetica", "normal");
        state.doc.setFontSize(10);
        setColor(state.doc, COLORS.muted);
        const subLines = splitText(state.doc, item.sub, cardWidth - 24);
        const offset = valueLines.length * lineHeight(18, 1.15);
        state.doc.text(subLines, x + 12, state.y + 44 + offset);
      }
    });

    state.y += rowHeight + 8;
  }
}

function divider(state: PdfState) {
  ensureSpace(state, 12);
  setDrawColor(state.doc, COLORS.line);
  state.doc.line(state.marginX, state.y, state.marginX + state.width, state.y);
  state.y += 12;
}

function preBlock(state: PdfState, title: string, text: string) {
  const headerHeight = 18;
  state.doc.setFont("courier", "normal");
  state.doc.setFontSize(9);
  const lines = splitText(state.doc, text || "None recorded.", state.width - 24);
  const height = Math.max(52, headerHeight + lines.length * lineHeight(9, 1.4) + 16);
  ensureSpace(state, height + 8);

  setFillColor(state.doc, COLORS.panel);
  setDrawColor(state.doc, COLORS.line);
  state.doc.roundedRect(state.marginX, state.y, state.width, height, 8, 8, "FD");
  state.doc.setFont("helvetica", "bold");
  state.doc.setFontSize(9);
  setColor(state.doc, COLORS.muted);
  state.doc.text(title.toUpperCase(), state.marginX + 10, state.y + 12);

  state.doc.setFont("courier", "normal");
  state.doc.setFontSize(9);
  setColor(state.doc, COLORS.ink);
  state.doc.text(lines, state.marginX + 10, state.y + 26);
  state.y += height + 8;
}

function detailCards(state: PdfState, items: Array<{ title: string; badges?: string[]; body: string; note?: string }>) {
  for (const item of items) {
    const bodyLines = splitText(state.doc, item.body, state.width - 24);
    const noteLines = item.note ? splitText(state.doc, item.note, state.width - 24) : [];
    const badgeLines = item.badges && item.badges.length > 0 ? 1 : 0;
    const height = 34 + badgeLines * 16 + bodyLines.length * lineHeight(11) + noteLines.length * lineHeight(10, 1.4) + 20;
    ensureSpace(state, Math.max(height, 68));

    setFillColor(state.doc, COLORS.panel);
    setDrawColor(state.doc, COLORS.line);
    state.doc.roundedRect(state.marginX, state.y, state.width, Math.max(height, 68), 8, 8, "FD");

    let localY = state.y + 14;
    state.doc.setFont("helvetica", "bold");
    state.doc.setFontSize(12);
    setColor(state.doc, COLORS.ink);
    const titleLines = splitText(state.doc, item.title, state.width - 24);
    state.doc.text(titleLines, state.marginX + 10, localY);
    localY += titleLines.length * lineHeight(12, 1.2) + 4;

    if (item.badges && item.badges.length > 0) {
      state.doc.setFont("helvetica", "normal");
      state.doc.setFontSize(9);
      setColor(state.doc, COLORS.accent);
      state.doc.text(item.badges.join("  ·  "), state.marginX + 10, localY);
      localY += 14;
    }

    state.doc.setFont("helvetica", "normal");
    state.doc.setFontSize(11);
    setColor(state.doc, COLORS.muted);
    state.doc.text(bodyLines, state.marginX + 10, localY);
    localY += bodyLines.length * lineHeight(11);

    if (item.note) {
      state.doc.setFontSize(10);
      setColor(state.doc, COLORS.muted);
      state.doc.text(noteLines, state.marginX + 10, localY + 2);
    }

    state.y += Math.max(height, 68) + 8;
  }
}

function buildPdf(payload: AnalysisReportExportPayload, doc: import("jspdf").jsPDF) {
  const subject = payload.scannerContext?.subject || payload.final.summary.email || "Aegis Desk Report";
  const state: PdfState = {
    doc,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    marginX: 40,
    marginY: 42,
    width: doc.internal.pageSize.getWidth() - 80,
    y: 42,
    subject,
    generatedAt: formatTimestamp(new Date().toISOString()),
  };

  pageHeader(state);
  paragraph(
    state,
    "This export captures the structured analytical flow from inbox triage through final synthesis, including scanner context, claims, evidence scoring, decisioning, and execution trace.",
    { size: 11, color: COLORS.muted }
  );
  metricCards(state, [
    {
      label: "Final Action",
      value: payload.final.decision.final_action.replace(/_/g, " "),
      tone: payload.final.decision.final_action === "human_review" ? "risk" : payload.final.decision.final_action === "escalate" ? "caution" : "clear",
      sub: payload.final.decision.reason,
    },
    {
      label: "Risk",
      value: `${payload.final.risk_assessment.level} · ${payload.final.risk_assessment.score}`,
      tone: payload.final.risk_assessment.level === "high" ? "risk" : payload.final.risk_assessment.level === "medium" ? "caution" : "clear",
      sub: payload.final.risk_assessment.rationale,
    },
    {
      label: "Uncertainty",
      value: `${payload.final.uncertainty.level} · ${formatPercent(payload.final.uncertainty.score)}`,
      tone: payload.final.uncertainty.level === "high" ? "risk" : payload.final.uncertainty.level === "medium" ? "caution" : "info",
      sub: payload.final.uncertainty.summary,
    },
    {
      label: "Evidence Quality",
      value: formatPercent(payload.final.evidence_quality_score || 0),
      tone: "info",
      sub: `${payload.final.evidence.length} evidence items · ${payload.final.conflicts.length} conflicts`,
    },
    {
      label: "Scanner Priority",
      value: payload.scannerContext ? `${payload.scannerContext.priority} · ${payload.scannerContext.priorityScore}` : "Not escalated from scanner",
      tone: payload.scannerContext?.priority === "high" ? "risk" : payload.scannerContext?.priority === "medium" ? "caution" : "clear",
      sub: payload.scannerContext?.primaryCategory || "Manual agent workflow",
    },
    {
      label: "Entities / Deadlines",
      value: `${payload.final.summary.entities.length} / ${payload.final.summary.deadlines.length}`,
      tone: "info",
      sub: `Entities and deadlines extracted from the structured run.`,
    },
  ]);

  sectionHeader(state, "Overview", "Executive Summary");
  paragraph(state, payload.final.summary.email || "No email summary generated.", { size: 12, color: COLORS.ink });
  if (payload.final.summary.document) {
    paragraph(state, payload.final.summary.document, { size: 11, color: COLORS.muted });
  }
  if (payload.final.summary.deadlines.length > 0) {
    paragraph(state, `Deadlines: ${payload.final.summary.deadlines.join(", ")}`, { size: 11, color: COLORS.muted, bold: true });
  }
  if (payload.final.summary.entities.length > 0) {
    paragraph(state, `Entities: ${payload.final.summary.entities.join(", ")}`, { size: 11, color: COLORS.muted, bold: true });
  }

  if (payload.scannerContext) {
    sectionHeader(state, "Inbox Scanner", "Initial Triage Context", "Structured context preserved from the inbox triage surface before escalation.");
    keyValueGrid(state, [
      { label: "Subject", value: payload.scannerContext.subject || "-" },
      { label: "Sender", value: payload.scannerContext.from || payload.scannerContext.senderEmail || "-" },
      { label: "Domain", value: payload.scannerContext.senderDomain || "-" },
      { label: "Category", value: payload.scannerContext.primaryCategory },
      { label: "Mail Class", value: payload.scannerContext.mailClass || "unknown" },
      { label: "Threat Type", value: payload.scannerContext.threatType || "unknown" },
      { label: "Priority", value: `${payload.scannerContext.priority} · ${payload.scannerContext.priorityScore}` },
      { label: "Trusted Decision", value: payload.scannerContext.trustedDecision?.action || "n/a" },
      { label: "Scanner Route", value: payload.scannerContext.decision?.final_action || "n/a" },
      { label: "Confidence", value: `${payload.scannerContext.trustedDecision?.confidencePct ?? payload.scannerContext.consensusScore}%` },
      { label: "Consensus", value: `${payload.scannerContext.consensusScore}%${typeof payload.scannerContext.consensusStrength === "number" ? ` · ${formatPercent(payload.scannerContext.consensusStrength)}` : ""}` },
      { label: "Uncertainty", value: `${payload.scannerContext.uncertaintyPercent}%` },
    ]);
    paragraph(state, payload.scannerContext.explanation?.summary || payload.scannerContext.decision?.reason || payload.scannerContext.trustedDecision?.note || payload.scannerContext.consensusNote || "No scanner explanation available.", { size: 11, color: COLORS.muted });
    bullets(state, (payload.scannerContext.explanation?.keyFactors || payload.scannerContext.riskTags || payload.scannerContext.signals).slice(0, 8));
    if (payload.scannerContext.disagreementFlags.length > 0) {
      paragraph(state, `Disagreement flags: ${payload.scannerContext.disagreementFlags.join(", ")}`, { size: 10, color: COLORS.caution, bold: true });
    }
    if (payload.scannerContext.signalGroups?.deterministic) {
      preBlock(state, "Deterministic Signal Groups", stringifyUnknown(payload.scannerContext.signalGroups.deterministic));
    }
    if (payload.scannerContext.signalGroups?.learned) {
      preBlock(state, "Learned Signal Groups", stringifyUnknown(payload.scannerContext.signalGroups.learned));
    }
  }

  sectionHeader(state, "Decision", "Risk, Uncertainty, and Operational Route");
  detailCards(state, [
    {
      title: `Decision · ${payload.final.decision.final_action.replace(/_/g, " ")}`,
      badges: [payload.final.decision.risk_level, `${formatPercent(payload.final.uncertainty.score)} uncertainty`],
      body: payload.final.decision.reason,
      note: payload.final.uncertainty.summary,
    },
  ]);
  bullets(state, payload.final.uncertainty.drivers);
  divider(state);
  bullets(
    state,
    payload.final.risk_assessment.findings.map((finding) => `${finding.severity.toUpperCase()} · ${finding.source} · ${finding.item}`)
  );

  sectionHeader(state, "Claims", "Structured Claims and Verification Notes");
  if (payload.final.claims.length > 0) {
    detailCards(
      state,
      payload.final.claims.map((claim) => ({
        title: claim.text,
        badges: [claim.type.replace(/_/g, " "), `${formatPercent(claim.confidence)} extraction confidence`, claim.verification?.status || "unverified"],
        body: claim.verification?.notes || "No verification notes recorded.",
      }))
    );
  } else {
    paragraph(state, "No claims were extracted.", { size: 11, color: COLORS.muted });
  }

  sectionHeader(state, "Research", "Evidence and Conflicts");
  if (payload.final.evidence.length > 0) {
    detailCards(
      state,
      payload.final.evidence.map((item) => ({
        title: item.title || item.url || "Evidence item",
        badges: [
          `${formatPercent(item.relevance_score || 0)} relevance`,
          `${formatPercent(item.source_quality_score || 0)} source quality`,
          `${formatPercent(item.recency_score || 0)} recency`,
        ],
        body: item.snippet || "No excerpt captured.",
        note: item.url,
      }))
    );
  } else {
    paragraph(state, "No external evidence was captured in this run.", { size: 11, color: COLORS.muted });
  }
  if (payload.final.conflicts.length > 0) {
    paragraph(state, "Conflicts detected across retrieved evidence:", { size: 11, color: COLORS.danger, bold: true });
    bullets(state, payload.final.conflicts.map((conflict) => `${conflict.type}: ${conflict.summary}`), { color: COLORS.muted });
  }

  sectionHeader(state, "Trust", "Entity Verification");
  if (payload.final.entityVerdicts.length > 0) {
    detailCards(
      state,
      payload.final.entityVerdicts.map((verdict) => ({
        title: verdict.entity,
        badges: [verdict.verdict, verdict.entityType, `${verdict.uncertaintyPct}% uncertainty`],
        body: verdict.rationale,
        note: verdict.redFlags.length > 0 ? `Red flags: ${verdict.redFlags.join(", ")}` : verdict.followUpChecks.join(", "),
      }))
    );
  } else {
    paragraph(state, "No entity verdicts were produced.", { size: 11, color: COLORS.muted });
  }

  sectionHeader(state, "Analysis", payload.final.analysisSection?.title || "Key Findings");
  if ((payload.final.analysisSection?.findings || []).length > 0) {
    detailCards(
      state,
      payload.final.analysisSection.findings.map((finding) => ({
        title: finding.risk,
        badges: [finding.severity],
        body: finding.whyItMatters,
        note: `Suggested edit: ${finding.suggestedEdit}`,
      }))
    );
  } else {
    paragraph(state, "No structured analysis findings were generated.", { size: 11, color: COLORS.muted });
  }

  sectionHeader(state, "Trace", "Plan, Ledger, and Research Events");
  const planSteps = normalizePlanSteps(payload.plan);
  if (planSteps.length > 0) {
    paragraph(state, "Planned steps:", { size: 11, color: COLORS.ink, bold: true });
    bullets(state, planSteps.map((step) => `${step.type || step.id || "step"} · ${step.description || step.desc || step.reason || step.title || "No description"}`));
  }
  paragraph(state, `Models used: ${joinOrFallback(payload.final.audit_trace.models_used, "Not recorded")}`, { size: 10, color: COLORS.muted, bold: true });
  paragraph(state, `Audit flags: ${joinOrFallback(payload.final.audit_trace.flags, "None recorded")}`, { size: 10, color: COLORS.muted });
  paragraph(state, `Audit timestamps: ${joinOrFallback(payload.final.audit_trace.timestamps, "Not recorded")}`, { size: 10, color: COLORS.muted });
  if ((payload.ledger || []).length > 0) {
    preBlock(state, "Ledger Events", stringifyUnknown(payload.ledger));
  }
  if ((payload.research || []).length > 0) {
    preBlock(state, "Research Events", stringifyUnknown(payload.research));
  }

  sectionHeader(state, "Appendix", "Inputs and Generated Artifacts");
  paragraph(state, `Command: ${payload.command || "No command recorded."}`, { size: 11, color: COLORS.ink, bold: true });
  preBlock(state, "Reply Draft", `Subject: ${payload.final.replyDraft?.subject || ""}\n\n${payload.final.replyDraft?.body || "No reply draft generated."}`);
  preBlock(state, "Meeting Invite", `Title: ${payload.final.meetingInvite?.title || "-"}\nTime: ${payload.final.meetingInvite?.datetimeISO || "-"}\n\n${payload.final.meetingInvite?.ics || "No ICS artifact recorded."}`);
  preBlock(state, "Email Input", payload.emailText || "No email text recorded.");
  preBlock(state, "Supporting Context", payload.docText || "No supporting context recorded.");

  footer(state);
}

export async function exportStructuredReportPdf(payload: AnalysisReportExportPayload) {
  if (typeof window === "undefined") return;

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  buildPdf(payload, doc);
  doc.save(`${subjectSlug(payload.scannerContext?.subject || payload.final.summary.email || "analysis-report")}.pdf`);
}
