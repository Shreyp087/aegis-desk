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

type ContractRisk = {
  risk: string;
  severity: "low" | "medium" | "high";
  whyItMatters: string;
  suggestedEdit: string;
};

type FinalOutput = {
  summary: {
    email: string;
    document: string;
    deadlines: string[];
    entities: string[];
  };
  entityVerdicts: EntityVerdict[];
  contractRisks: ContractRisk[];
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

function severityClass(severity: ContractRisk["severity"]): string {
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

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="text-sm text-neutral-400">Readable final output with verification evidence and actions.</div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 max-h-96 shadow-inner space-y-4">
        {!final ? (
          <div className="text-sm text-neutral-300 whitespace-pre-wrap">
            {stream || "Outputs will appear here after execution."}
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white mb-2">Executive Summary</div>
              <div className="text-sm text-neutral-200 mb-2">{final.summary.email}</div>
              <div className="text-sm text-neutral-300">{final.summary.document}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(final.summary.deadlines || []).map((deadline) => (
                  <span key={deadline} className="text-xs px-2 py-1 rounded-full border border-white/15 text-neutral-200">
                    Deadline: {deadline}
                  </span>
                ))}
                {(final.summary.entities || []).map((entity) => (
                  <span key={entity} className="text-xs px-2 py-1 rounded-full border border-white/15 text-neutral-200">
                    Entity: {entity}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white mb-2">Entity Verification</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-neutral-300 border-b border-white/10">
                      <th className="py-2 pr-3">Entity</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Verdict</th>
                      <th className="py-2 pr-3">Uncertainty</th>
                      <th className="py-2">Red Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(final.entityVerdicts || []).map((verdict) => (
                      <tr key={`${verdict.entity}-${verdict.verdict}`} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 text-neutral-100">{verdict.entity}</td>
                        <td className="py-2 pr-3 text-neutral-300">{verdict.entityType}</td>
                        <td className={`py-2 pr-3 font-semibold ${verdictClass(verdict.verdict)}`}>{verdict.verdict}</td>
                        <td className="py-2 pr-3 text-neutral-300">{verdict.uncertaintyPct}%</td>
                        <td className="py-2 text-neutral-300">{(verdict.redFlags || []).join(", ") || "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white mb-2">Contract Risks</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-neutral-300 border-b border-white/10">
                      <th className="py-2 pr-3">Risk</th>
                      <th className="py-2 pr-3">Severity</th>
                      <th className="py-2 pr-3">Why It Matters</th>
                      <th className="py-2">Suggested Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(final.contractRisks || []).map((risk, idx) => (
                      <tr key={`${risk.risk}-${idx}`} className="border-b border-white/5 align-top">
                        <td className="py-2 pr-3 text-neutral-100">{risk.risk}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-2 py-1 rounded-full border ${severityClass(risk.severity)}`}>
                            {risk.severity}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-neutral-300">{risk.whyItMatters}</td>
                        <td className="py-2 text-neutral-300">{risk.suggestedEdit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white mb-1">Reply Draft</div>
              <div className="text-xs text-neutral-400 mb-2">Subject: {final.replyDraft?.subject || "(No subject)"}</div>
              <pre className="text-sm whitespace-pre-wrap leading-relaxed text-neutral-200">
                {final.replyDraft?.body || "No draft generated."}
              </pre>
            </section>

            <section className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold text-white mb-1">Meeting Invite</div>
              <div className="text-sm text-neutral-200">Title: {final.meetingInvite?.title || "-"}</div>
              <div className="text-sm text-neutral-300 mb-2">Time: {final.meetingInvite?.datetimeISO || "-"}</div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(final.meetingInvite?.ics || "")}
                className="px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/10 text-sm"
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
