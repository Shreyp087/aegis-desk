type Proof = {
  title: string;
  url: string;
  snippet: string;
  reasonThisHelps: string;
};

type EntityVerdict = {
  entity: string;
  entityType: "person" | "company" | "organization" | "unknown";
  verdict: "genuine" | "suspicious" | "uncertain";
  uncertaintyPct: number;
  rationale: string;
  proof: Proof[];
  redFlags: string[];
  followUpChecks: string[];
};

type AnalysisFinding = {
  risk: string;
  severity: "low" | "medium" | "high";
  whyItMatters: string;
  suggestedEdit: string;
};

type AnalysisSection = {
  title: string;
  sectionType: "contract" | "security" | "finance" | "operations" | "scheduling" | "general";
  findings: AnalysisFinding[];
};

type FinalOutput = {
  summary: {
    email: string;
    document: string;
    deadlines: string[];
    entities: string[];
  };
  entityVerdicts: EntityVerdict[];
  analysisSection?: AnalysisSection;
  contractRisks?: AnalysisFinding[]; // legacy compatibility
  replyDraft: {
    subject: string;
    body: string;
  };
  meetingInvite: {
    title: string;
    datetimeISO: string;
    ics: string;
  };
  notes: {
    whatIDid: string[];
    uncertainties: string[];
  };
};

function severityClass(severity: AnalysisFinding["severity"]): string {
  if (severity === "high") return "text-red-300 border-red-500/40 bg-red-500/10";
  if (severity === "medium") return "text-yellow-300 border-yellow-500/40 bg-yellow-500/10";
  return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
}

function verdictClass(verdict: EntityVerdict["verdict"]): string {
  if (verdict === "suspicious") return "text-red-300";
  if (verdict === "uncertain") return "text-yellow-300";
  return "text-emerald-300";
}

function asFinalOutput(value: unknown): FinalOutput | null {
  if (!value || typeof value !== "object") return null;
  return value as FinalOutput;
}

export default function OutputPanel({ stream, outputs }: { stream: string; outputs: unknown }) {
  const final = asFinalOutput(outputs);
  const analysisTitle = final?.analysisSection?.title || (final?.contractRisks ? "Contract Risks" : "Key Risks & Actions");
  const analysisFindings = final?.analysisSection?.findings || final?.contractRisks || [];

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="panel-note">Readable final output with verification evidence and actions.</div>

      <div className="scroll-surface min-h-0 flex-1 overflow-auto p-4 max-h-none md:max-h-96 space-y-4">
        {!final ? (
          <div className="text-sm text-[var(--muted)] whitespace-pre-wrap">
            {stream || "Outputs will appear here after execution."}
          </div>
        ) : (
          <>
            <section className="output-section p-4">
              <div className="output-heading text-sm font-semibold mb-2">Executive Summary</div>
              <div className="text-sm text-[var(--text)] mb-2">{final.summary.email}</div>
              <div className="text-sm text-[var(--muted)]">{final.summary.document}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(final.summary.deadlines || []).map((deadline) => (
                  <span key={deadline} className="meta-pill text-xs px-2 py-1 rounded-full">
                    Deadline: {deadline}
                  </span>
                ))}
                {(final.summary.entities || []).map((entity) => (
                  <span key={entity} className="meta-pill text-xs px-2 py-1 rounded-full">
                    Entity: {entity}
                  </span>
                ))}
              </div>
            </section>

            <section className="output-section p-4">
              <div className="output-heading text-sm font-semibold mb-2">Entity Verification</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[var(--muted)] border-b border-[var(--stroke)]">
                      <th className="py-2 pr-3">Entity</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Verdict</th>
                      <th className="py-2 pr-3">Uncertainty</th>
                      <th className="py-2">Red Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(final.entityVerdicts || []).map((verdict) => (
                      <tr key={`${verdict.entity}-${verdict.verdict}`} className="border-b border-[rgba(255,255,255,0.05)] align-top">
                        <td className="py-2 pr-3 text-[var(--text)]">{verdict.entity}</td>
                        <td className="py-2 pr-3 text-[var(--muted)]">{verdict.entityType}</td>
                        <td className={`py-2 pr-3 font-semibold ${verdictClass(verdict.verdict)}`}>{verdict.verdict}</td>
                        <td className="py-2 pr-3 text-[var(--muted)]">{verdict.uncertaintyPct}%</td>
                        <td className="py-2 text-[var(--muted)]">{(verdict.redFlags || []).join(", ") || "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 space-y-3">
                {(final.entityVerdicts || []).map((verdict, idx) => (
                  <div key={`${verdict.entity}-proof-${idx}`} className="rounded-lg border border-[var(--stroke)] bg-[rgba(255,255,255,0.02)] p-3">
                    <div className="text-xs font-semibold text-[var(--text)] mb-1">
                      Proof for {verdict.entity}
                    </div>
                    <div className="text-xs text-[var(--muted)] mb-2">{verdict.rationale}</div>
                    {verdict.proof && verdict.proof.length > 0 ? (
                      <div className="space-y-2">
                        {verdict.proof.map((item, proofIdx) => (
                          <div key={`${verdict.entity}-proof-item-${proofIdx}`} className="text-xs text-[var(--muted)]">
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[var(--text)] underline break-all"
                              >
                                {item.title || item.url}
                              </a>
                            ) : (
                              <div className="text-[var(--text)]">{item.title || "Source"}</div>
                            )}
                            {item.snippet ? <div className="mt-1">Snippet: {item.snippet}</div> : null}
                            <div className="mt-1">Why it helps: {item.reasonThisHelps}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--muted)]">No proof items provided.</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="output-section p-4">
              <div className="output-heading text-sm font-semibold mb-2">{analysisTitle}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[var(--muted)] border-b border-[var(--stroke)]">
                      <th className="py-2 pr-3">Risk</th>
                      <th className="py-2 pr-3">Severity</th>
                      <th className="py-2 pr-3">Why It Matters</th>
                      <th className="py-2">Suggested Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysisFindings.map((risk, idx) => (
                      <tr key={`${risk.risk}-${idx}`} className="border-b border-[rgba(255,255,255,0.05)] align-top">
                        <td className="py-2 pr-3 text-[var(--text)]">{risk.risk}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-2 py-1 rounded-full border ${severityClass(risk.severity)}`}>
                            {risk.severity}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-[var(--muted)]">{risk.whyItMatters}</td>
                        <td className="py-2 text-[var(--muted)]">{risk.suggestedEdit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="output-section p-4">
              <div className="output-heading text-sm font-semibold mb-1">Reply Draft</div>
              <div className="text-xs text-[var(--muted)] mb-2">Subject: {final.replyDraft?.subject || "(No subject)"}</div>
              <pre className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--text)]">
                {final.replyDraft?.body || "No draft generated."}
              </pre>
            </section>

            <section className="output-section p-4">
              <div className="output-heading text-sm font-semibold mb-1">Meeting Invite</div>
              <div className="text-sm text-[var(--text)]">Title: {final.meetingInvite?.title || "-"}</div>
              <div className="text-sm text-[var(--muted)] mb-2">Time: {final.meetingInvite?.datetimeISO || "-"}</div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(final.meetingInvite?.ics || "")}
                className="secondary-ghost px-3 py-1.5 rounded-lg text-sm"
              >
                Copy ICS
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
