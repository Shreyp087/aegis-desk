import type { ReactNode } from "react";

import { Document, PDFDownloadLink, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

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

type AnalysisReportDownloadLinkProps = {
  payload: AnalysisReportExportPayload;
  className?: string;
  label?: string;
  children?: ReactNode;
};

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

function softWrapText(value: string): string {
  return value
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /\s+/.test(part) || part.length <= 30) return part;
      return part
        .replace(/([/_?&=#.:~\-])/g, "$1\u200b")
        .replace(/(.{30})/g, "$1\u200b");
    })
    .join("");
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return softWrapText(value);
  try {
    return softWrapText(JSON.stringify(value, null, 2));
  } catch {
    return softWrapText(String(value));
  }
}

function joinOrFallback(values: string[] | undefined, fallback = "None recorded"): string {
  return softWrapText(values && values.length > 0 ? values.join(", ") : fallback);
}

export function buildStructuredReportPdfFileName(payload: AnalysisReportExportPayload): string {
  return `${subjectSlug(payload.scannerContext?.subject || payload.final.summary.email || "analysis-report")}.pdf`;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
    color: "#0f172a",
    fontSize: 10,
    lineHeight: 1.5,
  },
  headerBand: {
    backgroundColor: "#eff6ff",
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 18,
  },
  brand: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    color: "#1d4ed8",
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.2,
  },
  generated: {
    marginTop: 6,
    fontSize: 9,
    color: "#475569",
  },
  lede: {
    marginTop: 10,
    fontSize: 10,
    color: "#334155",
    lineHeight: 1.7,
  },
  section: {
    marginTop: 18,
  },
  sectionLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#1d4ed8",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.25,
    marginBottom: 10,
  },
  card: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  compactCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    color: "#64748b",
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 10,
    color: "#334155",
    lineHeight: 1.7,
  },
  mutedText: {
    marginTop: 6,
    fontSize: 9,
    color: "#64748b",
    lineHeight: 1.55,
  },
  metricValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.25,
    marginBottom: 4,
  },
  riskTone: { color: "#b91c1c" },
  cautionTone: { color: "#b45309" },
  clearTone: { color: "#047857" },
  infoTone: { color: "#1d4ed8" },
  list: {
    marginTop: 6,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 5,
  },
  bullet: {
    width: 10,
    fontSize: 10,
    color: "#1d4ed8",
  },
  listText: {
    flexGrow: 1,
    fontSize: 10,
    color: "#334155",
    lineHeight: 1.6,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
  },
  chip: {
    backgroundColor: "#dbeafe",
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  chipText: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1d4ed8",
  },
  codeBlock: {
    marginTop: 8,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 10,
  },
  codeTitle: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#64748b",
    marginBottom: 6,
  },
  codeText: {
    fontFamily: "Courier",
    fontSize: 8.4,
    lineHeight: 1.5,
    color: "#0f172a",
  },
  footer: {
    marginTop: 18,
    fontSize: 8,
    color: "#64748b",
  },
});

function toneStyle(tone?: "risk" | "caution" | "clear" | "info") {
  if (tone === "risk") return styles.riskTone;
  if (tone === "caution") return styles.cautionTone;
  if (tone === "clear") return styles.clearTone;
  return styles.infoTone;
}

function Section({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {items.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.chip}>
          <Text style={styles.chipText}>{softWrapText(item)}</Text>
        </View>
      ))}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  const listItems = items.length > 0 ? items : ["None recorded."];
  return (
    <View style={styles.list}>
      {listItems.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.listItem}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.listText}>{softWrapText(item)}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailBlock({ title, body, extra, chips }: { title: string; body: string; extra?: string; chips?: string[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{softWrapText(title)}</Text>
      <Text style={styles.bodyText}>{softWrapText(body)}</Text>
      {chips && chips.length > 0 ? <ChipRow items={chips} /> : null}
      {extra ? <Text style={styles.mutedText}>{softWrapText(extra)}</Text> : null}
    </View>
  );
}

function CodeBlock({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.codeBlock}>
      <Text style={styles.codeTitle}>{title}</Text>
      <Text style={styles.codeText}>{softWrapText(value || "None recorded.")}</Text>
    </View>
  );
}

function AnalysisReportDocument({ payload }: { payload: AnalysisReportExportPayload }) {
  const subject = payload.scannerContext?.subject || payload.final.summary.email || "Aegis Desk Report";
  const generatedAt = formatTimestamp(new Date().toISOString());
  const planSteps = normalizePlanSteps(payload.plan);

  return (
    <Document title={subject} author="Aegis Desk" subject="Structured analysis report">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.headerBand}>
          <Text style={styles.brand}>Aegis Desk / Structured Analysis Report</Text>
          <Text style={styles.title}>{softWrapText(subject)}</Text>
          <Text style={styles.generated}>Generated {generatedAt}</Text>
          <Text style={styles.lede}>
            This report captures the analysis from inbox triage through final synthesis, including claims, evidence, uncertainty, decisioning, and execution trace.
          </Text>
        </View>

        <Section label="Summary" title="Executive Summary">
          <DetailBlock
            title="Summary"
            body={payload.final.summary.email || payload.final.summary.document || "No summary generated."}
            extra={
              payload.final.summary.deadlines.length > 0
                ? `Deadlines: ${payload.final.summary.deadlines.join(", ")}`
                : undefined
            }
            chips={payload.final.summary.entities}
          />
          <View style={styles.compactCard}>
            <Text style={styles.cardTitle}>Decision</Text>
            <Text style={[styles.metricValue, toneStyle(payload.final.risk_assessment.level === "high" ? "risk" : payload.final.risk_assessment.level === "medium" ? "caution" : "clear")]}>
              {softWrapText(payload.final.decision.final_action)}
            </Text>
            <Text style={styles.bodyText}>{softWrapText(payload.final.decision.reason)}</Text>
            <Text style={styles.mutedText}>Risk level: {softWrapText(payload.final.decision.risk_level)}</Text>
          </View>
          <View style={styles.compactCard}>
            <Text style={styles.cardTitle}>Uncertainty</Text>
            <Text style={styles.metricValue}>{formatPercent(payload.final.uncertainty.score)}</Text>
            <Text style={styles.bodyText}>{softWrapText(payload.final.uncertainty.summary)}</Text>
            <BulletList items={payload.final.uncertainty.drivers} />
          </View>
        </Section>

        <Section label="Risk" title="Risk Assessment">
          <DetailBlock
            title={`${payload.final.risk_assessment.level.toUpperCase()} risk posture`}
            body={`Evidence quality: ${formatPercent(payload.final.evidence_quality_score)}.`}
            extra={`Primary recommendation: ${payload.final.decision.final_action}`}
            chips={[payload.final.risk_assessment.level, payload.final.decision.risk_level]}
          />
          <BulletList
            items={payload.final.risk_assessment.findings.map(
              (finding) => `${finding.severity.toUpperCase()} · ${finding.source} · ${finding.item}`
            )}
          />
        </Section>

        <Section label="Claims" title="Claims and Verification Hook">
          {(payload.final.claims || []).length > 0 ? (
            payload.final.claims.map((claim, index) => (
              <DetailBlock
                key={`${claim.type}-${index}`}
                title={`${claim.type} · ${formatPercent(claim.confidence)}`}
                body={claim.text}
                extra={`${claim.verification.status}: ${claim.verification.notes}`}
              />
            ))
          ) : (
            <DetailBlock title="Claims" body="No structured claims were generated." />
          )}
        </Section>

        {(payload.scannerContext || null) ? (
          <Section label="Scanner" title="Inbox Scanner Context">
            <DetailBlock
              title={payload.scannerContext?.subject || "Inbox signal"}
              body={
                payload.scannerContext?.explanation?.summary ||
                payload.scannerContext?.decision?.reason ||
                payload.scannerContext?.trustedDecision?.note ||
                payload.scannerContext?.consensusNote ||
                "No scanner explanation available."
              }
              extra={`Mail class: ${payload.scannerContext?.mailClass || "not recorded"} · Threat type: ${payload.scannerContext?.threatType || "not recorded"}`}
              chips={[
                payload.scannerContext?.decision?.final_action || payload.scannerContext?.trustedDecision?.action || "review",
                payload.scannerContext?.decision?.risk_level || payload.scannerContext?.mailClass || "unknown",
              ]}
            />
            <BulletList items={payload.scannerContext?.signals?.slice(0, 8) || []} />
          </Section>
        ) : null}

        <Text style={styles.footer}>Prepared from the Aegis Desk structured workflow.</Text>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Section label="Evidence" title="Research Evidence and Conflicts">
          <DetailBlock
            title="Evidence quality"
            body={`Aggregate evidence quality score: ${formatPercent(payload.final.evidence_quality_score)}`}
            extra={`Conflicts detected: ${(payload.final.conflicts || []).length}`}
          />
          {(payload.final.evidence || []).length > 0 ? (
            payload.final.evidence.slice(0, 12).map((item, index) => (
              <DetailBlock
                key={`${item.title}-${index}`}
                title={item.title || "Evidence item"}
                body={item.snippet || "No excerpt provided."}
                extra={`Source quality ${formatPercent(item.source_quality_score)} · Relevance ${formatPercent(item.relevance_score)} · Recency ${formatPercent(item.recency_score)}`}
              />
            ))
          ) : (
            <DetailBlock title="Evidence" body="No evidence records were generated." />
          )}
          {(payload.final.conflicts || []).length > 0 ? (
            <BulletList items={payload.final.conflicts.map((conflict) => `${conflict.type}: ${conflict.summary}`)} />
          ) : null}
        </Section>

        <Section label="Verification" title="Entity Verdicts">
          {(payload.final.entityVerdicts || []).length > 0 ? (
            payload.final.entityVerdicts.map((verdict, index) => (
              <DetailBlock
                key={`${verdict.entity}-${index}`}
                title={`${verdict.entity} · ${verdict.verdict}`}
                body={verdict.rationale || "No verification rationale recorded."}
                extra={`Uncertainty ${formatPercent(verdict.uncertaintyPct, "percent")} · Red flags ${verdict.redFlags.length} · Follow-up checks ${verdict.followUpChecks.length}`}
              />
            ))
          ) : (
            <DetailBlock title="Entity verdicts" body="No entity verdicts were generated." />
          )}
        </Section>

        <Section label="Analysis" title="Analyst Findings and Drafts">
          {(payload.final.analysisSection?.findings || []).length > 0 ? (
            payload.final.analysisSection.findings.map((finding, index) => (
              <DetailBlock
                key={`${finding.risk}-${index}`}
                title={`${finding.risk} · ${finding.severity}`}
                body={finding.whyItMatters}
                extra={`Suggested edit: ${finding.suggestedEdit}`}
              />
            ))
          ) : (
            <DetailBlock title="Analysis" body="No structured analysis findings were generated." />
          )}
          <DetailBlock title={payload.final.replyDraft?.subject || "Reply draft"} body={payload.final.replyDraft?.body || "No reply draft generated."} />
          <DetailBlock
            title={payload.final.meetingInvite?.title || "Meeting invite"}
            body={payload.final.meetingInvite?.ics || "No meeting invite generated."}
            extra={`Scheduled time: ${payload.final.meetingInvite?.datetimeISO || "Not recorded"}`}
          />
        </Section>

        <Text style={styles.footer}>Page 2 / Analysis and evidence</Text>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Section label="Trace" title="Plan, Audit, and Research Trace">
          <DetailBlock title="Planned steps" body={`${planSteps.length} steps recorded.`} />
          <BulletList
            items={planSteps.map(
              (step) => `${step.type || step.id || "step"} · ${step.description || step.desc || step.reason || step.title || "No description"}`
            )}
          />
          <DetailBlock
            title="Audit trace"
            body={`Models: ${joinOrFallback(payload.final.audit_trace.models_used, "Not recorded")}`}
            extra={`Flags: ${joinOrFallback(payload.final.audit_trace.flags, "None recorded")} · Timestamps: ${joinOrFallback(payload.final.audit_trace.timestamps, "Not recorded")}`}
          />
          {(payload.ledger || []).length > 0 ? <CodeBlock title="Ledger events" value={stringifyUnknown(payload.ledger)} /> : null}
          {(payload.research || []).length > 0 ? <CodeBlock title="Research events" value={stringifyUnknown(payload.research)} /> : null}
        </Section>

        <Section label="Appendix" title="Inputs and Supporting Context">
          <DetailBlock title="Command" body={payload.command || "No command recorded."} />
          <CodeBlock title="Email input" value={payload.emailText || "No email text recorded."} />
          <CodeBlock title="Supporting context" value={payload.docText || "No supporting context recorded."} />
        </Section>

        <Text style={styles.footer}>Page 3 / Trace and appendix</Text>
      </Page>
    </Document>
  );
}

export function AnalysisReportDownloadLink({
  payload,
  className,
  label = "Export PDF",
  children,
}: AnalysisReportDownloadLinkProps) {
  return (
    <PDFDownloadLink
      document={<AnalysisReportDocument payload={payload} />}
      fileName={buildStructuredReportPdfFileName(payload)}
      className={className}
    >
      {({ loading, error }) => {
        if (error) return "PDF unavailable";
        return loading ? "Preparing PDF…" : children ?? label;
      }}
    </PDFDownloadLink>
  );
}
