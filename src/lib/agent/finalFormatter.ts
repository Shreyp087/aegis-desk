import { z } from "zod";

import { VerifiedClaimSchema } from "@/lib/agent/claimVerification";
import { EvidenceConflictSchema, EvidenceItemSchema } from "@/lib/agent/evidence";

const SummarySchema = z.object({
  email: z.string().default(""),
  document: z.string().default(""),
  deadlines: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
});

const ProofSchema = z.object({
  title: z.string().default(""),
  url: z.string().default(""),
  snippet: z.string().default(""),
  reasonThisHelps: z.string().default(""),
});

const EntityVerdictSchema = z.object({
  entity: z.string().default(""),
  entityType: z.enum(["person", "company", "organization", "unknown"]).default("unknown"),
  verdict: z.enum(["genuine", "suspicious", "uncertain"]).default("uncertain"),
  uncertaintyPct: z.number().min(0).max(100).default(50),
  rationale: z.string().default(""),
  proof: z.array(ProofSchema).default([]),
  redFlags: z.array(z.string()).default([]),
  followUpChecks: z.array(z.string()).default([]),
});

const AnalysisFindingSchema = z.object({
  risk: z.string().default(""),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  whyItMatters: z.string().default(""),
  suggestedEdit: z.string().default(""),
});

const AnalysisSectionSchema = z.object({
  title: z.string().default("Key Risks & Actions"),
  sectionType: z.enum(["contract", "security", "finance", "operations", "scheduling", "general"]).default("general"),
  findings: z.array(AnalysisFindingSchema).default([]),
});

const ReplyDraftSchema = z.object({
  subject: z.string().default(""),
  body: z.string().default(""),
});

const MeetingInviteSchema = z.object({
  title: z.string().default(""),
  datetimeISO: z.string().default(""),
  ics: z.string().default(""),
});

const NotesSchema = z.object({
  whatIDid: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
});

const LegacyFinalSchema = z.object({
  summary: SummarySchema.default(SummarySchema.parse({})),
  entityVerdicts: z.array(EntityVerdictSchema).default([]),
  analysisSection: AnalysisSectionSchema.default(AnalysisSectionSchema.parse({})),
  contractRisks: z.array(AnalysisFindingSchema).default([]),
  replyDraft: ReplyDraftSchema.default(ReplyDraftSchema.parse({})),
  meetingInvite: MeetingInviteSchema.default(MeetingInviteSchema.parse({})),
  claims: z.array(VerifiedClaimSchema).default([]),
  notes: NotesSchema.default(NotesSchema.parse({})),
  evidence: z.array(EvidenceItemSchema).default([]),
  conflicts: z.array(EvidenceConflictSchema).default([]),
  evidence_quality_score: z.number().min(0).max(1).default(0),
});

const RiskAssessmentEntrySchema = z.object({
  item: z.string().default(""),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  source: z.enum(["analysis", "entity_verdict", "research_conflict", "notes"]).default("analysis"),
});

export const RiskAssessmentSchema = z.object({
  level: z.enum(["low", "medium", "high"]).default("medium"),
  score: z.number().min(0).max(100).default(0),
  findings: z.array(RiskAssessmentEntrySchema).default([]),
  rationale: z.string().default("No structured risk assessment was provided upstream."),
});

export const DecisionSchema = z.object({
  final_action: z.enum(["auto_triage", "escalate", "human_review"]).default("human_review"),
  reason: z.string().default("No upstream decision was available; formatter supplied a default."),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
});

export const UncertaintySummarySchema = z.object({
  score: z.number().min(0).max(1).default(0.5),
  level: z.enum(["low", "medium", "high"]).default("medium"),
  drivers: z.array(z.string()).default([]),
  summary: z.string().default("Uncertainty summary defaulted because upstream output did not provide one."),
});

const AuditTraceStepSchema = z.object({
  id: z.string().default(""),
  type: z.string().default("unknown"),
  description: z.string().default(""),
  status: z.enum(["completed", "observed", "planned"]).default("observed"),
});

export const AuditTraceSchema = z.object({
  steps: z.array(AuditTraceStepSchema).default([]),
  models_used: z.array(z.string()).default([]),
  timestamps: z.array(z.string()).default([]),
  flags: z.array(z.string()).default([]),
});

export const FormattedFinalOutputSchema = LegacyFinalSchema.extend({
  risk_assessment: RiskAssessmentSchema.default(RiskAssessmentSchema.parse({})),
  decision: DecisionSchema.default(DecisionSchema.parse({})),
  uncertainty: UncertaintySummarySchema.default(UncertaintySummarySchema.parse({})),
  audit_trace: AuditTraceSchema.default(AuditTraceSchema.parse({})),
});

export type FormattedFinalOutput = z.infer<typeof FormattedFinalOutputSchema>;

type RunPlanStep = {
  id?: string;
  type?: string;
  desc?: string;
  title?: string;
};

type LedgerEvent = {
  ts?: string;
  type?: string;
  message?: string;
};

type FormatFinalOutputArgs = {
  final: unknown;
  plan?: { steps?: RunPlanStep[] } | null;
  ledger?: LedgerEvent[] | null;
  modelsUsed?: string[];
  generatedAt?: string;
};

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function riskLevelFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function summarizeRiskAssessment(final: z.infer<typeof LegacyFinalSchema>) {
  const findings: Array<z.infer<typeof RiskAssessmentEntrySchema>> = [];

  for (const finding of final.analysisSection.findings) {
    findings.push({
      item: finding.risk || finding.whyItMatters || "Analysis finding",
      severity: finding.severity,
      source: "analysis",
    });
  }

  for (const verdict of final.entityVerdicts) {
    if (verdict.verdict === "genuine") continue;
    findings.push({
      item: `${verdict.entity || "Entity"} marked ${verdict.verdict}`,
      severity: verdict.verdict === "suspicious" ? "high" : "medium",
      source: "entity_verdict",
    });
  }

  for (const conflict of final.conflicts) {
    findings.push({
      item: conflict.summary || "Research conflict detected",
      severity: conflict.type === "domain_mismatch" ? "high" : "medium",
      source: "research_conflict",
    });
  }

  for (const note of final.notes.uncertainties) {
    findings.push({
      item: note,
      severity: "medium",
      source: "notes",
    });
  }

  const highCount = findings.filter((entry) => entry.severity === "high").length;
  const mediumCount = findings.filter((entry) => entry.severity === "medium").length;
  const lowCount = findings.filter((entry) => entry.severity === "low").length;

  const baseScore = Math.min(100, highCount * 28 + mediumCount * 15 + lowCount * 6);
  const evidencePenalty = Math.round((1 - final.evidence_quality_score) * 25);
  const score = Math.min(100, baseScore + evidencePenalty);
  const level = riskLevelFromScore(score);

  const rationaleParts = [
    `${highCount} high-severity signals`,
    `${mediumCount} medium-severity signals`,
    `${final.conflicts.length} evidence conflicts`,
    `evidence quality ${Math.round(final.evidence_quality_score * 100)}%`,
  ];

  return RiskAssessmentSchema.parse({
    level,
    score,
    findings: findings.slice(0, 8),
    rationale: `Derived from analysis findings, entity verdicts, and research conflicts: ${rationaleParts.join(", ")}.`,
  });
}

function summarizeUncertainty(final: z.infer<typeof LegacyFinalSchema>) {
  const verdictScores = final.entityVerdicts.map((entry) => entry.uncertaintyPct / 100);
  const verdictAverage =
    verdictScores.length > 0 ? verdictScores.reduce((sum, value) => sum + value, 0) / verdictScores.length : 0.45;
  const evidencePenalty = 1 - final.evidence_quality_score;
  const conflictPenalty = Math.min(1, final.conflicts.length * 0.2);
  const score = round(clamp01(verdictAverage * 0.55 + evidencePenalty * 0.3 + conflictPenalty * 0.15));
  const level = score >= 0.67 ? "high" : score >= 0.34 ? "medium" : "low";

  const drivers = [
    ...final.notes.uncertainties,
    ...final.conflicts.map((conflict) => conflict.summary),
  ];
  if (final.evidence_quality_score < 0.45) {
    drivers.push("Evidence quality is below the preferred threshold.");
  }
  if (drivers.length === 0) {
    drivers.push("No explicit uncertainty drivers were supplied upstream.");
  }

  return UncertaintySummarySchema.parse({
    score,
    level,
    drivers: drivers.slice(0, 8),
    summary: `Uncertainty is ${level} based on entity-verdict uncertainty and evidence quality.`,
  });
}

function deriveDecision(
  riskAssessment: z.infer<typeof RiskAssessmentSchema>,
  uncertainty: z.infer<typeof UncertaintySummarySchema>
) {
  let finalAction: "auto_triage" | "escalate" | "human_review" = "human_review";
  let reason = "Formatter defaulted to human review because structured risk inputs were incomplete.";

  if (riskAssessment.level === "low" && uncertainty.level === "low") {
    finalAction = "auto_triage";
    reason = "Auto-triage selected because risk and uncertainty are both low in the formatted output.";
  } else if (riskAssessment.level === "medium" || uncertainty.level === "medium") {
    finalAction = "escalate";
    reason = "Escalation selected because the formatted output indicates moderate risk or uncertainty.";
  } else if (riskAssessment.level === "high" || uncertainty.level === "high") {
    finalAction = "human_review";
    reason = "Human review selected because the formatted output indicates high risk or high uncertainty.";
  }

  return DecisionSchema.parse({
    final_action: finalAction,
    reason,
    risk_level: riskAssessment.level,
  });
}

function deriveStepStatus(stepId: string, ledger: LedgerEvent[]): "completed" | "observed" | "planned" {
  if (!stepId) return "planned";
  const completed = ledger.some((entry) => typeof entry.message === "string" && entry.message.includes(`Completed step ${stepId}`));
  if (completed) return "completed";
  const started = ledger.some((entry) => typeof entry.message === "string" && entry.message.includes(stepId));
  return started ? "observed" : "planned";
}

function deriveAuditTrace(
  final: z.infer<typeof LegacyFinalSchema>,
  plan: { steps?: RunPlanStep[] } | null | undefined,
  ledger: LedgerEvent[],
  modelsUsed: string[],
  generatedAt: string
) {
  const steps = (plan?.steps ?? []).map((step) => ({
    id: step.id || "",
    type: step.type || "unknown",
    description: step.desc || step.title || "",
    status: deriveStepStatus(step.id || "", ledger),
  }));

  const timestamps = [...new Set(ledger.map((entry) => entry.ts).filter((value): value is string => Boolean(value)))];
  if (timestamps.length === 0) timestamps.push(generatedAt);

  const flags = [
    ...final.conflicts.map((conflict) => conflict.type),
    ...final.entityVerdicts
      .filter((verdict) => verdict.verdict !== "genuine")
      .map((verdict) => `${verdict.verdict}_entity:${verdict.entity || "unknown"}`),
  ];
  if (final.evidence_quality_score < 0.45) flags.push("low_evidence_quality");
  if (final.claims.length === 0) flags.push("no_claims_extracted");
  if (!final.meetingInvite.ics) flags.push("missing_meeting_artifact");

  return AuditTraceSchema.parse({
    steps,
    models_used: [...new Set(modelsUsed)].filter(Boolean),
    timestamps,
    flags: [...new Set(flags)],
  });
}

export function formatFinalOutput(args: FormatFinalOutputArgs): FormattedFinalOutput {
  const generatedAt = args.generatedAt || new Date().toISOString();
  const legacy = LegacyFinalSchema.parse(args.final ?? {});
  const riskAssessment = summarizeRiskAssessment(legacy);
  const uncertainty = summarizeUncertainty(legacy);
  const decision = deriveDecision(riskAssessment, uncertainty);
  const auditTrace = deriveAuditTrace(legacy, args.plan, args.ledger ?? [], args.modelsUsed ?? [], generatedAt);

  return FormattedFinalOutputSchema.parse({
    ...legacy,
    risk_assessment: riskAssessment,
    decision,
    uncertainty,
    audit_trace: auditTrace,
  });
}
