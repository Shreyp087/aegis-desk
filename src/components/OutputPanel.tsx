import type { FormattedFinalOutput } from "@/lib/agent/finalFormatter";
import type { AgentEscalationScannerContext } from "@/lib/agent/prefill";

import { AegisButton, EmptyState, StatusBadge } from "@/components/ui/AegisPrimitives";

type AnalysisFinding = NonNullable<FormattedFinalOutput["analysisSection"]>["findings"][number];
type EntityVerdict = FormattedFinalOutput["entityVerdicts"][number];

type OutputPanelProps = {
  stream: string;
  outputs: unknown;
  scannerContext?: AgentEscalationScannerContext | null;
};

function toneForSeverity(severity: AnalysisFinding["severity"]): "risk" | "caution" | "clear" {
  if (severity === "high") return "risk";
  if (severity === "medium") return "caution";
  return "clear";
}

function toneForVerdict(verdict: EntityVerdict["verdict"]): "risk" | "caution" | "clear" {
  if (verdict === "suspicious") return "risk";
  if (verdict === "uncertain") return "caution";
  return "clear";
}

function toneForLevel(level: "low" | "medium" | "high"): "risk" | "caution" | "clear" {
  if (level === "high") return "risk";
  if (level === "medium") return "caution";
  return "clear";
}

function toneForDecision(action: FormattedFinalOutput["decision"]["final_action"]): "risk" | "caution" | "clear" {
  if (action === "human_review") return "risk";
  if (action === "escalate") return "caution";
  return "clear";
}

function asFinalOutput(value: unknown): FormattedFinalOutput | null {
  if (!value || typeof value !== "object") return null;
  return value as FormattedFinalOutput;
}

function Section({
  label,
  title,
  subtitle,
  children,
}: {
  label: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-aegis-border bg-aegis-elevated/80 p-4 md:p-5">
      <div className="flex flex-col gap-1 border-b border-aegis-border/80 pb-3">
        <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">{label}</div>
        {title ? <h3 className="text-sm font-medium text-aegis-text">{title}</h3> : null}
        {subtitle ? <p className="text-sm leading-relaxed text-aegis-muted">{subtitle}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricTile({ label, value, tone, sub }: { label: string; value: string; tone: "risk" | "caution" | "clear" | "info" | "muted"; sub?: string }) {
  const toneClass =
    tone === "risk"
      ? "text-aegis-risk"
      : tone === "caution"
        ? "text-aegis-caution"
        : tone === "clear"
          ? "text-aegis-clear"
          : tone === "info"
            ? "text-aegis-info"
            : "text-aegis-text";

  return (
    <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
      <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">{label}</div>
      <div className={`mt-2 text-2xl font-medium tracking-tight ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{sub}</div> : null}
    </div>
  );
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-aegis-border bg-aegis-base/70 px-4 py-3">
          <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">{item.label}</div>
          <div className="mt-2 min-w-0 break-words text-sm leading-relaxed text-aegis-text">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function OutputPanel({ stream, outputs, scannerContext }: OutputPanelProps) {
  const final = asFinalOutput(outputs);
  const findings = final?.analysisSection?.findings || [];
  const scannerExplanation = scannerContext?.explanation?.summary || scannerContext?.decision?.reason || scannerContext?.trustedDecision?.note;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" id="agent-output">
      {!final ? (
        <EmptyState
          className="min-h-64"
          title="No final output yet"
          description={stream || "Run the agent to generate the structured report, claims, evidence, and draft response."}
        />
      ) : (
        <div className="grid gap-4">
          <section className="rounded-2xl border border-aegis-border bg-aegis-base/60 p-5 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="text-xs font-mono uppercase tracking-[0.16em] text-aegis-dim">Structured Report</div>
                <h2 className="mt-3 text-2xl font-medium tracking-tight text-aegis-text">{scannerContext?.subject || final.summary.email || "Final analysis output"}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-aegis-muted">
                  {final.summary.email || "No email summary generated."}
                </p>
                {final.summary.document ? <p className="mt-2 text-sm leading-relaxed text-aegis-muted">{final.summary.document}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <StatusBadge tone={toneForDecision(final.decision.final_action)}>{final.decision.final_action.toUpperCase()}</StatusBadge>
                <StatusBadge tone={toneForLevel(final.risk_assessment.level)}>{final.risk_assessment.level.toUpperCase()}</StatusBadge>
                <StatusBadge tone={toneForLevel(final.uncertainty.level)}>{final.uncertainty.level} uncertainty</StatusBadge>
                <StatusBadge tone="info">Evidence {Math.round((final.evidence_quality_score || 0) * 100)}%</StatusBadge>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Final Action" value={final.decision.final_action.replace(/_/g, " ")} tone={toneForDecision(final.decision.final_action)} sub={final.decision.reason} />
              <MetricTile label="Risk" value={`${final.risk_assessment.level} · ${final.risk_assessment.score}`} tone={toneForLevel(final.risk_assessment.level)} sub={final.risk_assessment.rationale} />
              <MetricTile label="Uncertainty" value={`${final.uncertainty.level} · ${Math.round(final.uncertainty.score * 100)}%`} tone={toneForLevel(final.uncertainty.level)} sub={final.uncertainty.summary} />
              <MetricTile label="Evidence Quality" value={`${Math.round((final.evidence_quality_score || 0) * 100)}%`} tone="info" sub={`${final.conflicts.length} conflicts · ${final.evidence.length} evidence items`} />
            </div>

            {(final.summary.deadlines.length > 0 || final.summary.entities.length > 0) ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {final.summary.deadlines.map((deadline) => (
                  <StatusBadge key={deadline} tone="caution">DEADLINE · {deadline}</StatusBadge>
                ))}
                {final.summary.entities.map((entity) => (
                  <StatusBadge key={entity} tone="info">ENTITY · {entity}</StatusBadge>
                ))}
              </div>
            ) : null}
          </section>

          {scannerContext ? (
            <Section
              label="Inbox Scanner"
              title="Initial triage context"
              subtitle="This captures the scanner’s structured view before the message moved into the main reasoning workspace."
            >
              <KeyValueGrid
                items={[
                  { label: "Sender", value: scannerContext.from || scannerContext.senderEmail || "-" },
                  { label: "Domain", value: scannerContext.senderDomain || "-" },
                  { label: "Category", value: scannerContext.primaryCategory },
                  { label: "Mail Class", value: scannerContext.mailClass || "unknown" },
                  { label: "Threat Type", value: scannerContext.threatType || "unknown" },
                  { label: "Priority", value: `${scannerContext.priority} · ${scannerContext.priorityScore}` },
                  { label: "Trusted Decision", value: scannerContext.trustedDecision?.action || "n/a" },
                  { label: "Scanner Route", value: scannerContext.decision?.final_action || "n/a" },
                  { label: "Consensus", value: `${scannerContext.consensusScore}%${typeof scannerContext.consensusStrength === "number" ? ` · ${Math.round(scannerContext.consensusStrength * 100)}%` : ""}` },
                  { label: "Trust / Reputation", value: `${scannerContext.trustScore} / ${scannerContext.reputationScore}` },
                  { label: "Uncertainty", value: `${scannerContext.uncertaintyPercent}%` },
                  { label: "Captured", value: new Date(scannerContext.capturedAt).toLocaleString() },
                ]}
              />

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Scanner Explanation</div>
                  <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{scannerExplanation || "No scanner explanation was recorded."}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(scannerContext.explanation?.keyFactors || scannerContext.riskTags || []).slice(0, 6).map((factor) => (
                      <StatusBadge key={factor} tone="caution">{factor}</StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Signal Overview</div>
                  <div className="mt-3 grid gap-2 text-sm leading-relaxed text-aegis-muted">
                    {(scannerContext.signals || []).slice(0, 8).map((signal) => (
                      <div key={signal} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-aegis-caution" />
                        <span>{signal}</span>
                      </div>
                    ))}
                    {scannerContext.disagreementFlags.length > 0 ? (
                      <div className="pt-2 text-sm text-aegis-muted">Disagreement: {scannerContext.disagreementFlags.join(", ")}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </Section>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <Section label="Risk Assessment" title="Why the system rates this analysis the way it does">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={toneForLevel(final.risk_assessment.level)}>{final.risk_assessment.level.toUpperCase()}</StatusBadge>
                <StatusBadge tone="info">Score {final.risk_assessment.score}</StatusBadge>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{final.risk_assessment.rationale}</div>
              <div className="mt-4 grid gap-3">
                {final.risk_assessment.findings.map((finding, index) => (
                  <div key={`${finding.item}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-3">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={toneForLevel(finding.severity)}>{finding.severity.toUpperCase()}</StatusBadge>
                      <StatusBadge tone="muted">{finding.source}</StatusBadge>
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-aegis-text">{finding.item}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section label="Decision" title="Recommended operational route">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={toneForDecision(final.decision.final_action)}>{final.decision.final_action.toUpperCase()}</StatusBadge>
                <StatusBadge tone={toneForLevel(final.decision.risk_level)}>{final.decision.risk_level.toUpperCase()}</StatusBadge>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{final.decision.reason}</div>
              <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Uncertainty Drivers</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {final.uncertainty.drivers.length > 0 ? final.uncertainty.drivers.map((driver) => (
                    <StatusBadge key={driver} tone="muted">{driver}</StatusBadge>
                  )) : <div className="text-sm text-aegis-muted">No uncertainty drivers were recorded.</div>}
                </div>
              </div>
            </Section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section label="Claims" title="Raw claims extracted from the message">
              {final.claims.length > 0 ? (
                <div className="grid gap-3">
                  {final.claims.map((claim, index) => (
                    <div key={`${claim.type}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone="info">{claim.type.toUpperCase()}</StatusBadge>
                        <StatusBadge tone="muted">{Math.round((claim.confidence || 0) * 100)}% confidence</StatusBadge>
                        <StatusBadge tone="muted">{claim.verification?.status || "unverified"}</StatusBadge>
                      </div>
                      <div className="mt-3 text-sm leading-relaxed text-aegis-text">{claim.text}</div>
                      <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{claim.verification?.notes || "No verification notes available."}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-aegis-muted">No claims were extracted.</div>
              )}
            </Section>

            <Section label="Evidence" title="Research results scored for usefulness">
              {final.evidence.length > 0 ? (
                <div className="grid gap-3">
                  {final.evidence.map((evidence, index) => (
                    <div key={`${evidence.url}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone="info">relevance {Math.round((evidence.relevance_score || 0) * 100)}%</StatusBadge>
                        <StatusBadge tone="muted">source {Math.round((evidence.source_quality_score || 0) * 100)}%</StatusBadge>
                        <StatusBadge tone="muted">recency {Math.round((evidence.recency_score || 0) * 100)}%</StatusBadge>
                      </div>
                      <div className="mt-3 text-sm font-medium text-aegis-text">{evidence.title || evidence.url}</div>
                      <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{evidence.snippet || "No excerpt captured."}</div>
                    </div>
                  ))}
                  {final.conflicts.length > 0 ? (
                    <div className="rounded-xl border border-aegis-risk/30 bg-aegis-risk/10 p-4">
                      <div className="text-xs font-mono uppercase tracking-widest text-aegis-risk">Conflicts</div>
                      <div className="mt-3 grid gap-2 text-sm leading-relaxed text-aegis-muted">
                        {final.conflicts.map((conflict, index) => (
                          <div key={`${conflict.type}-${index}`}>{conflict.type}: {conflict.summary}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-aegis-muted">No evidence was returned.</div>
              )}
            </Section>
          </div>

          <Section label="Entity Verification" title="Profiles and verdicts attached to named entities">
            <div className="grid gap-3">
              {final.entityVerdicts.map((verdict, index) => (
                <div key={`${verdict.entity}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={toneForVerdict(verdict.verdict)}>{verdict.verdict.toUpperCase()}</StatusBadge>
                    <StatusBadge tone="muted">{verdict.entityType}</StatusBadge>
                    <StatusBadge tone="muted">{verdict.uncertaintyPct}% uncertainty</StatusBadge>
                  </div>
                  <div className="mt-3 text-sm font-medium text-aegis-text">{verdict.entity}</div>
                  <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{verdict.rationale}</div>
                  {verdict.redFlags.length > 0 ? <div className="mt-3 text-sm leading-relaxed text-aegis-muted">Red flags: {verdict.redFlags.join(", ")}</div> : null}
                </div>
              ))}
            </div>
          </Section>

          <Section label={final.analysisSection?.title || "Analysis"} title="Structured findings and recommended edits">
            {findings.length > 0 ? (
              <div className="grid gap-3">
                {findings.map((finding, index) => (
                  <div key={`${finding.risk}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={toneForSeverity(finding.severity)}>{finding.severity.toUpperCase()}</StatusBadge>
                    </div>
                    <div className="mt-3 text-sm font-medium text-aegis-text">{finding.risk}</div>
                    <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{finding.whyItMatters}</div>
                    <div className="mt-3 text-sm leading-relaxed text-aegis-muted">Suggested edit: {finding.suggestedEdit}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-aegis-muted">No structured analysis findings were returned.</div>
            )}
          </Section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Section label="Reply Draft" title="Suggested outbound communication">
              <div className="text-sm text-aegis-muted">Subject: {final.replyDraft?.subject || "(No subject)"}</div>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-aegis-border bg-aegis-base/70 p-4 text-sm font-mono leading-relaxed text-aegis-text">
                {final.replyDraft?.body || "No draft generated."}
              </pre>
            </Section>

            <Section label="Meeting Invite" title="Follow-up artifact">
              <div className="grid gap-3 text-sm leading-relaxed text-aegis-muted">
                <div>Title: {final.meetingInvite?.title || "-"}</div>
                <div>Time: {final.meetingInvite?.datetimeISO || "-"}</div>
                <AegisButton variant="secondary" onClick={() => navigator.clipboard.writeText(final.meetingInvite?.ics || "")}>Copy ICS</AegisButton>
              </div>
            </Section>
          </div>

          <Section label="Audit Trace" title="Models, timestamps, and structured trace flags">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="grid gap-2">
                {(final.audit_trace.steps || []).map((step, index) => (
                  <div key={`${step.id}-${index}`} className="rounded-xl border border-aegis-border bg-aegis-base/70 p-3 text-sm leading-relaxed text-aegis-muted">
                    <div className="text-aegis-text">{step.type}{step.description ? ` · ${step.description}` : ""}</div>
                    <div className="mt-1">{step.status ? `Status: ${step.status}` : "Status unavailable"}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Models Used</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(final.audit_trace.models_used || []).map((model) => (
                      <StatusBadge key={model} tone="muted">{model}</StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Flags</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(final.audit_trace.flags || []).map((flag) => (
                      <StatusBadge key={flag} tone="caution">{flag}</StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-aegis-border bg-aegis-base/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-aegis-dim">Timestamps</div>
                  <div className="mt-3 grid gap-1">
                    {(final.audit_trace.timestamps || []).map((timestamp) => (
                      <div key={timestamp} className="aegis-time">{timestamp}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
