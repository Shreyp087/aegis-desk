import type { FormattedFinalOutput } from "@/lib/agent/finalFormatter";

import { AegisButton, EmptyState, StatusBadge } from "@/components/ui/AegisPrimitives";

type AnalysisFinding = NonNullable<FormattedFinalOutput["analysisSection"]>["findings"][number];
type EntityVerdict = FormattedFinalOutput["entityVerdicts"][number];

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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-aegis-border bg-aegis-elevated p-4">
      <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">{label}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function OutputPanel({ stream, outputs }: { stream: string; outputs: unknown }) {
  const final = asFinalOutput(outputs);
  const findings = final?.analysisSection?.findings || [];

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
          <Section label="Summary">
            <div className="grid gap-2">
              <div className="text-sm leading-relaxed text-aegis-text">{final.summary.email || "No email summary generated."}</div>
              <div className="text-sm leading-relaxed text-aegis-muted">{final.summary.document || "No supporting document summary generated."}</div>
              <div className="flex flex-wrap gap-2">
                {(final.summary.deadlines || []).map((deadline) => (
                  <StatusBadge key={deadline} tone="caution">DEADLINE · {deadline}</StatusBadge>
                ))}
                {(final.summary.entities || []).map((entity) => (
                  <StatusBadge key={entity} tone="info">ENTITY · {entity}</StatusBadge>
                ))}
              </div>
            </div>
          </Section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section label="Risk Assessment">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={toneForLevel(final.risk_assessment.level)}>{final.risk_assessment.level.toUpperCase()}</StatusBadge>
                <StatusBadge tone="info">Score {final.risk_assessment.score}</StatusBadge>
                <StatusBadge tone="info">Evidence {Math.round((final.evidence_quality_score || 0) * 100)}%</StatusBadge>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{final.risk_assessment.rationale}</div>
            </Section>

            <Section label="Decision">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={toneForDecision(final.decision.final_action)}>{final.decision.final_action.toUpperCase()}</StatusBadge>
                <StatusBadge tone={toneForLevel(final.decision.risk_level)}>{final.decision.risk_level.toUpperCase()}</StatusBadge>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{final.decision.reason}</div>
              <div className="mt-3 text-sm leading-relaxed text-aegis-muted">Uncertainty: {final.uncertainty.summary}</div>
            </Section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section label="Claims">
              {final.claims.length > 0 ? (
                <div className="grid gap-3">
                  {final.claims.map((claim, index) => (
                    <div key={`${claim.type}-${index}`} className="rounded border border-aegis-border bg-aegis-base p-3">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone="info">{claim.type.toUpperCase()}</StatusBadge>
                        <StatusBadge tone="muted">{Math.round((claim.confidence || 0) * 100)}% confidence</StatusBadge>
                        <StatusBadge tone="muted">{claim.verification?.status || "unverified"}</StatusBadge>
                      </div>
                      <div className="mt-2 text-sm leading-relaxed text-aegis-text">{claim.text}</div>
                      <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{claim.verification?.notes || "No verification notes available."}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-aegis-muted">No claims were extracted.</div>
              )}
            </Section>

            <Section label="Evidence">
              {final.evidence.length > 0 ? (
                <div className="grid gap-3">
                  {final.evidence.map((evidence, index) => (
                    <div key={`${evidence.url}-${index}`} className="rounded border border-aegis-border bg-aegis-base p-3">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone="info">relevance {Math.round((evidence.relevance_score || 0) * 100)}%</StatusBadge>
                        <StatusBadge tone="muted">source {Math.round((evidence.source_quality_score || 0) * 100)}%</StatusBadge>
                        <StatusBadge tone="muted">recency {Math.round((evidence.recency_score || 0) * 100)}%</StatusBadge>
                      </div>
                      <div className="mt-2 text-sm font-medium text-aegis-text">{evidence.title || evidence.url}</div>
                      <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{evidence.snippet || "No excerpt captured."}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-aegis-muted">No evidence was returned.</div>
              )}
            </Section>
          </div>

          <Section label="Entity Verification">
            <div className="grid gap-3">
              {final.entityVerdicts.map((verdict, index) => (
                <div key={`${verdict.entity}-${index}`} className="rounded border border-aegis-border bg-aegis-base p-3">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={toneForVerdict(verdict.verdict)}>{verdict.verdict.toUpperCase()}</StatusBadge>
                    <StatusBadge tone="muted">{verdict.entityType}</StatusBadge>
                    <StatusBadge tone="muted">{verdict.uncertaintyPct}% uncertainty</StatusBadge>
                  </div>
                  <div className="mt-2 text-sm font-medium text-aegis-text">{verdict.entity}</div>
                  <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{verdict.rationale}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section label={final.analysisSection?.title || "Analysis"}>
            {findings.length > 0 ? (
              <div className="grid gap-3">
                {findings.map((finding, index) => (
                  <div key={`${finding.risk}-${index}`} className="rounded border border-aegis-border bg-aegis-base p-3">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={toneForSeverity(finding.severity)}>{finding.severity.toUpperCase()}</StatusBadge>
                    </div>
                    <div className="mt-2 text-sm font-medium text-aegis-text">{finding.risk}</div>
                    <div className="mt-2 text-sm leading-relaxed text-aegis-muted">{finding.whyItMatters}</div>
                    <div className="mt-2 text-sm leading-relaxed text-aegis-muted">Suggested edit: {finding.suggestedEdit}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-aegis-muted">No structured analysis findings were returned.</div>
            )}
          </Section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Section label="Reply Draft">
              <div className="text-sm text-aegis-muted">Subject: {final.replyDraft?.subject || "(No subject)"}</div>
              <pre className="mt-3 whitespace-pre-wrap text-sm font-mono leading-relaxed text-aegis-text">
                {final.replyDraft?.body || "No draft generated."}
              </pre>
            </Section>

            <Section label="Meeting Invite">
              <div className="grid gap-2 text-sm leading-relaxed text-aegis-muted">
                <div>Title: {final.meetingInvite?.title || "-"}</div>
                <div>Time: {final.meetingInvite?.datetimeISO || "-"}</div>
                <AegisButton variant="secondary" onClick={() => navigator.clipboard.writeText(final.meetingInvite?.ics || "")}>Copy ICS</AegisButton>
              </div>
            </Section>
          </div>

          <Section label="Audit Trace">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="grid gap-2">
                {(final.audit_trace.steps || []).map((step, index) => (
                  <div key={`${step.id}-${index}`} className="text-sm leading-relaxed text-aegis-muted">
                    {step.type}
                    {step.description ? ` · ${step.description}` : ""}
                    {step.status ? ` (${step.status})` : ""}
                  </div>
                ))}
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  {(final.audit_trace.models_used || []).map((model) => (
                    <StatusBadge key={model} tone="muted">{model}</StatusBadge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(final.audit_trace.flags || []).map((flag) => (
                    <StatusBadge key={flag} tone="caution">{flag}</StatusBadge>
                  ))}
                </div>
                <div className="grid gap-1">
                  {(final.audit_trace.timestamps || []).map((timestamp) => (
                    <div key={timestamp} className="aegis-time">{timestamp}</div>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
