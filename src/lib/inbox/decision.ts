import { z } from "zod";

export const InboxDecisionActionEnum = z.enum(["auto_triage", "escalate", "human_review"]);
export const InboxRiskLevelEnum = z.enum(["low", "medium", "high"]);

export const InboxDecisionSchema = z.object({
  final_action: InboxDecisionActionEnum,
  reason: z.string(),
  risk_level: InboxRiskLevelEnum,
});

export type InboxDecision = z.infer<typeof InboxDecisionSchema>;

export type InboxDecisionPolicyConfig = {
  autoTriageConfidenceMinPct: number;
  autoTriageUncertaintyMaxPct: number;
  escalateConfidenceMinPct: number;
  escalateUncertaintyMaxPct: number;
  riskMediumMinScore: number;
  riskHighMinScore: number;
  policyVersion: string;
};

type RouteInboxDecisionArgs = {
  confidencePct: number;
  uncertaintyPercent: number;
  riskScore: number;
  disagreementFlags?: string[];
  config?: InboxDecisionPolicyConfig;
};

const DEFAULT_POLICY_CONFIG: InboxDecisionPolicyConfig = {
  autoTriageConfidenceMinPct: 82,
  autoTriageUncertaintyMaxPct: 28,
  escalateConfidenceMinPct: 60,
  escalateUncertaintyMaxPct: 52,
  riskMediumMinScore: 40,
  riskHighMinScore: 70,
  policyVersion: "inbox-decision-routing-v1",
};

const HARD_REVIEW_FLAGS = new Set([
  "force_escalation_review",
  "label_disagreement",
  "action_disagreement",
  "all_models_failed",
  "not_analyzed_budget_capped",
]);

const MODERATE_DISAGREEMENT_FLAGS = new Set([
  "confidence_variance_high",
  "entity_overlap_low",
  "partial_model_failure",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseEnvNumber(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export function buildEnvDecisionPolicyConfig(
  env: NodeJS.ProcessEnv = process.env
): InboxDecisionPolicyConfig {
  return {
    autoTriageConfidenceMinPct: parseEnvNumber(
      env.INBOX_DECISION_AUTO_TRIAGE_CONFIDENCE_MIN_PCT,
      DEFAULT_POLICY_CONFIG.autoTriageConfidenceMinPct,
      0,
      100
    ),
    autoTriageUncertaintyMaxPct: parseEnvNumber(
      env.INBOX_DECISION_AUTO_TRIAGE_UNCERTAINTY_MAX_PCT,
      DEFAULT_POLICY_CONFIG.autoTriageUncertaintyMaxPct,
      0,
      100
    ),
    escalateConfidenceMinPct: parseEnvNumber(
      env.INBOX_DECISION_ESCALATE_CONFIDENCE_MIN_PCT,
      DEFAULT_POLICY_CONFIG.escalateConfidenceMinPct,
      0,
      100
    ),
    escalateUncertaintyMaxPct: parseEnvNumber(
      env.INBOX_DECISION_ESCALATE_UNCERTAINTY_MAX_PCT,
      DEFAULT_POLICY_CONFIG.escalateUncertaintyMaxPct,
      0,
      100
    ),
    riskMediumMinScore: parseEnvNumber(
      env.INBOX_DECISION_RISK_MEDIUM_MIN_SCORE,
      DEFAULT_POLICY_CONFIG.riskMediumMinScore,
      0,
      100
    ),
    riskHighMinScore: parseEnvNumber(
      env.INBOX_DECISION_RISK_HIGH_MIN_SCORE,
      DEFAULT_POLICY_CONFIG.riskHighMinScore,
      0,
      100
    ),
    policyVersion:
      env.INBOX_DECISION_POLICY_VERSION?.trim() || DEFAULT_POLICY_CONFIG.policyVersion,
  };
}

function deriveRiskLevel(
  riskScore: number,
  config: InboxDecisionPolicyConfig
): z.infer<typeof InboxRiskLevelEnum> {
  if (riskScore >= config.riskHighMinScore) return "high";
  if (riskScore >= config.riskMediumMinScore) return "medium";
  return "low";
}

function formatFlags(flags: string[]): string {
  return flags.join(", ");
}

export function routeInboxDecision(args: RouteInboxDecisionArgs): InboxDecision {
  const config = args.config ?? DEFAULT_POLICY_CONFIG;
  const disagreementFlags = args.disagreementFlags ?? [];
  const hardFlags = disagreementFlags.filter((flag) => HARD_REVIEW_FLAGS.has(flag));
  const moderateFlags = disagreementFlags.filter((flag) => MODERATE_DISAGREEMENT_FLAGS.has(flag));
  const riskLevel = deriveRiskLevel(args.riskScore, config);

  if (hardFlags.length > 0) {
    return InboxDecisionSchema.parse({
      final_action: "human_review",
      reason: `Human review: hard disagreement or fallback condition detected (${formatFlags(hardFlags)}).`,
      risk_level: riskLevel,
    });
  }

  const autoTriageEligible =
    args.confidencePct >= config.autoTriageConfidenceMinPct &&
    args.uncertaintyPercent <= config.autoTriageUncertaintyMaxPct &&
    moderateFlags.length === 0;

  if (autoTriageEligible) {
    return InboxDecisionSchema.parse({
      final_action: "auto_triage",
      reason: `Auto-triage: confidence ${Math.round(args.confidencePct)}%, uncertainty ${Math.round(
        args.uncertaintyPercent
      )}%, no blocking disagreement.`,
      risk_level: riskLevel,
    });
  }

  const escalateEligible =
    args.confidencePct >= config.escalateConfidenceMinPct ||
    args.uncertaintyPercent <= config.escalateUncertaintyMaxPct;

  if (escalateEligible) {
    const moderationNote =
      moderateFlags.length > 0
        ? ` Moderate disagreement flags were present (${formatFlags(moderateFlags)}).`
        : "";
    return InboxDecisionSchema.parse({
      final_action: "escalate",
      reason: `Escalate: confidence ${Math.round(args.confidencePct)}% and uncertainty ${Math.round(
        args.uncertaintyPercent
      )}% did not satisfy auto-triage conditions.${moderationNote}`,
      risk_level: riskLevel,
    });
  }

  return InboxDecisionSchema.parse({
    final_action: "human_review",
    reason: `Human review: confidence ${Math.round(args.confidencePct)}% and uncertainty ${Math.round(
      args.uncertaintyPercent
    )}% did not meet escalation thresholds.`,
    risk_level: riskLevel,
  });
}
