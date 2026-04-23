import type { IncidentHint } from "./classifier";
import {
  rebalanceDecisionImportanceProfile,
  type DecisionImportanceProfile,
} from "./importance";
import type { InboxEventInference, InboxEventType } from "./eventTaxonomy";

export type LearningCorrectionResult = {
  adjustedProfile: DecisionImportanceProfile;
  correctionMode:
    | "neutral"
    | "promo_fatigue"
    | "transactional_protection"
    | "harmful_reinforcement"
    | "mixed";
  promoFatigueScore: number;
  transactionalProtectionScore: number;
  harmfulReinforcementScore: number;
  senderSampleCount: number;
  categorySampleCount: number;
  trustDiscountApplied: number;
  ruleHits: string[];
  signals: string[];
  rationale: string;
};

type LearningCorrectionInput = {
  primaryCategory: string;
  decisionImportance: DecisionImportanceProfile;
  eventContext: Pick<
    InboxEventInference,
    "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
  >;
  incidentHints: IncidentHint[];
  promotional: {
    lowRiskPromotional: boolean;
    promotionalConfidence: number;
    promoUrgencyHits: number;
    senderPromoHints: number;
  };
  trust: {
    score: number;
    seen: number;
    highCount: number;
    mediumCount: number;
  };
};

type OutcomeKind =
  | "confirmed_low_value"
  | "protective"
  | "confirmed_harmful"
  | "neutral";

const PROMO_CATEGORIES = new Set(["sales_marketing", "newsletter"]);
const PROMO_EVENTS = new Set<InboxEventType>([
  "promotional_commerce",
  "bulk_marketing",
  "newsletter",
]);
const TRANSACTIONAL_EVENTS = new Set<InboxEventType>([
  "auth_otp",
  "login_code",
  "login_alert",
  "password_reset",
  "password_changed",
  "account_recovery",
  "new_membership",
  "new_device_signin",
  "purchase_confirmed",
  "order_shipped",
  "receipt_invoice",
  "billing_issue",
  "subscription_renewal",
  "refund_update",
  "job_application_update",
  "interview_scheduled",
  "recruiter_reply",
  "deadline_action_required",
  "legal_notice",
  "calendar_or_schedule",
  "security_warning",
]);

/**
 * Bounds a score delta or derived pressure value to a safe range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Returns the matching historical hints for the current category.
 */
function getSameCategoryHints(
  hints: IncidentHint[],
  primaryCategory: string
): IncidentHint[] {
  return hints.filter((hint) => hint.primaryCategory === primaryCategory);
}

/**
 * Returns promo-family hints for the current sender/domain memory bucket.
 */
function getPromoFamilyHints(hints: IncidentHint[]): IncidentHint[] {
  return hints.filter((hint) => PROMO_CATEGORIES.has(hint.primaryCategory ?? ""));
}

/**
 * Classifies one feedback outcome into the learning buckets used by promo suppression and transactional protection.
 */
function classifyOutcome(hint: IncidentHint): OutcomeKind {
  if (hint.outcomeLabel === "harmful_true_positive") {
    return "confirmed_harmful";
  }

  if (hint.outcomeLabel === "spam_true_positive") {
    return "confirmed_low_value";
  }

  if (
    hint.outcomeLabel === "spam_false_positive" ||
    hint.outcomeLabel === "harmful_false_positive" ||
    hint.outcomeLabel === "actionable_correct"
  ) {
    return "protective";
  }

  if (hint.outcomeLabel === "informational_correct") {
    return hint.priorityScore >= 45 ? "protective" : "confirmed_low_value";
  }

  return "neutral";
}

/**
 * Counts the number of hints that landed in a given outcome bucket.
 */
function countOutcomes(hints: IncidentHint[], kind: OutcomeKind): number {
  return hints.filter((hint) => classifyOutcome(hint) === kind).length;
}

/**
 * Returns true when the current event should be treated as high-value benign or operational mail rather than as promo noise.
 */
function isProtectedEvent(input: LearningCorrectionInput): boolean {
  const allEvents = [
    input.eventContext.primaryEventType,
    ...input.eventContext.secondaryTags,
  ];
  return (
    input.eventContext.primaryEventType !== "phishing_or_impersonation" &&
    allEvents.some((eventType) => TRANSACTIONAL_EVENTS.has(eventType)) &&
    input.eventContext.confidence >= 55
  );
}

/**
 * Returns true when the current event still looks like promotional or newsletter noise after event inference.
 */
function isPromotionalEvent(input: LearningCorrectionInput): boolean {
  const allEvents = [
    input.eventContext.primaryEventType,
    ...input.eventContext.secondaryTags,
  ];
  return (
    input.promotional.lowRiskPromotional ||
    PROMO_CATEGORIES.has(input.primaryCategory) ||
    allEvents.some((eventType) => PROMO_EVENTS.has(eventType))
  );
}

/**
 * Computes a sender-familiarity trust discount when frequent mail does not translate into user-valued outcomes.
 */
function computeTrustDiscount(input: LearningCorrectionInput): number {
  if (input.trust.seen < 6) {
    return 0;
  }

  const engagedRatio =
    input.trust.seen > 0
      ? (input.trust.highCount + input.trust.mediumCount) / input.trust.seen
      : 0;
  if (engagedRatio >= 0.35) {
    return 0;
  }

  return clamp(
    Math.round((0.35 - engagedRatio) * 20 + (input.trust.score >= 60 ? 4 : 0)),
    0,
    10
  );
}

/**
 * Applies one bounded delta set to a decision-importance profile.
 */
function applyProfileDeltas(
  profile: DecisionImportanceProfile,
  deltas: {
    threat?: number;
    urgency?: number;
    relevance?: number;
    opportunity?: number;
    noise?: number;
  }
): DecisionImportanceProfile {
  return rebalanceDecisionImportanceProfile({
    ...profile,
    threatScore: clamp(profile.threatScore + (deltas.threat ?? 0), 0, 100),
    urgencyScore: clamp(profile.urgencyScore + (deltas.urgency ?? 0), 0, 100),
    relevanceScore: clamp(profile.relevanceScore + (deltas.relevance ?? 0), 0, 100),
    opportunityScore: clamp(
      profile.opportunityScore + (deltas.opportunity ?? 0),
      0,
      100
    ),
    noiseScore: clamp(profile.noiseScore + (deltas.noise ?? 0), 0, 100),
  });
}

/**
 * Applies category-aware sender learning so promo fatigue does not poison transactional mail from the same sender ecosystem.
 */
export function applyLearningCorrections(
  input: LearningCorrectionInput
): LearningCorrectionResult {
  const sameCategoryHints = getSameCategoryHints(
    input.incidentHints,
    input.primaryCategory
  );
  const promoFamilyHints = getPromoFamilyHints(input.incidentHints);
  const protectedEvent = isProtectedEvent(input);
  const promotionalEvent = isPromotionalEvent(input);
  const trustDiscount = computeTrustDiscount(input);

  let adjustedProfile = input.decisionImportance;
  const ruleHits: string[] = [];
  const signals: string[] = [];
  const rationales: string[] = [];
  let correctionMode: LearningCorrectionResult["correctionMode"] = "neutral";
  let promoFatigueScore = 0;
  let transactionalProtectionScore = 0;
  let harmfulReinforcementScore = 0;

  if (promotionalEvent && !protectedEvent) {
    const promoHints = sameCategoryHints.length > 0 ? sameCategoryHints : promoFamilyHints;
    const lowValueCount = countOutcomes(promoHints, "confirmed_low_value");
    const protectiveCount = countOutcomes(promoHints, "protective");

    if (
      promoHints.length >= 2 &&
      lowValueCount >= 2 &&
      lowValueCount > protectiveCount
    ) {
      const noiseDelta = Math.min(
        22,
        6 +
          lowValueCount * 3 +
          Math.round(input.promotional.promotionalConfidence * 2) +
          trustDiscount
      );
      const urgencyDelta = -Math.min(
        8,
        input.promotional.promoUrgencyHits * 2 +
          Math.max(0, input.promotional.senderPromoHints - 1)
      );
      const relevanceDelta = -Math.min(
        18,
        4 + (lowValueCount - protectiveCount) * 3
      );
      const opportunityDelta = -Math.min(12, 2 + lowValueCount * 2);

      adjustedProfile = applyProfileDeltas(adjustedProfile, {
        urgency: urgencyDelta,
        relevance: relevanceDelta,
        opportunity: opportunityDelta,
        noise: noiseDelta,
      });
      promoFatigueScore = clamp(
        32 +
          lowValueCount * 12 +
          Math.round(input.promotional.promotionalConfidence * 10),
        0,
        100
      );
      ruleHits.push("learning_promo_fatigue");
      if (trustDiscount > 0) {
        ruleHits.push("learning_trust_discount");
      }
      signals.push(
        `learning promo fatigue ${lowValueCount}/${promoHints.length} low-value outcomes in sender/category history`
      );
      if (trustDiscount > 0) {
        signals.push(
          `learning trust discount ${trustDiscount}: repeated sender familiarity did not translate into user-valued mail`
        );
      }
      rationales.push(
        "Repeated low-value promo outcomes from this sender/category pushed Aegis to suppress attention without treating the message as harmful."
      );
      correctionMode = "promo_fatigue";
    }
  }

  if (protectedEvent) {
    const promoLowValueCount = countOutcomes(
      promoFamilyHints,
      "confirmed_low_value"
    );
    const sameCategoryProtectiveCount = countOutcomes(
      sameCategoryHints,
      "protective"
    );
    const falsePositiveProtectionCount = input.incidentHints.filter(
      (hint) =>
        hint.outcomeLabel === "spam_false_positive" ||
        hint.outcomeLabel === "harmful_false_positive"
    ).length;

    if (
      promoLowValueCount >= 2 ||
      sameCategoryProtectiveCount >= 1 ||
      falsePositiveProtectionCount >= 1
    ) {
      const relevanceDelta = Math.min(
        18,
        8 + promoLowValueCount * 2 + sameCategoryProtectiveCount * 3
      );
      const urgencyDelta = Math.min(
        12,
        4 +
          Math.round(input.eventContext.sensitiveEvent.attentionBoost * 0.3) +
          Math.min(3, falsePositiveProtectionCount)
      );
      const noiseDelta = -Math.min(
        16,
        8 + promoLowValueCount * 2 + sameCategoryProtectiveCount * 3
      );

      adjustedProfile = applyProfileDeltas(adjustedProfile, {
        urgency: urgencyDelta,
        relevance: relevanceDelta,
        noise: noiseDelta,
      });
      transactionalProtectionScore = clamp(
        28 +
          promoLowValueCount * 10 +
          sameCategoryProtectiveCount * 12 +
          falsePositiveProtectionCount * 8,
        0,
        100
      );
      ruleHits.push("learning_transactional_protection");
      signals.push(
        `learning transactional protection ignored ${promoLowValueCount} promo-noise outcome(s) for the same sender ecosystem`
      );
      rationales.push(
        "Historical promo fatigue was not allowed to bury a transactional or account-critical event from the same sender ecosystem."
      );
      correctionMode =
        correctionMode === "neutral" ? "transactional_protection" : "mixed";
    }
  }

  if (
    input.eventContext.primaryEventType === "phishing_or_impersonation" &&
    sameCategoryHints.length > 0
  ) {
    const harmfulCount = countOutcomes(sameCategoryHints, "confirmed_harmful");
    if (harmfulCount > 0) {
      const threatDelta = Math.min(12, 4 + harmfulCount * 4);
      adjustedProfile = applyProfileDeltas(adjustedProfile, {
        threat: threatDelta,
        noise: -Math.min(4, harmfulCount),
      });
      harmfulReinforcementScore = clamp(35 + harmfulCount * 18, 0, 100);
      ruleHits.push("learning_harmful_reinforcement");
      signals.push(
        `learning harmful reinforcement ${harmfulCount} prior harmful outcome(s) for the same category`
      );
      rationales.push(
        "Prior harmful outcomes in the same sender/category lane reinforced the threat reading instead of letting the message blend into routine finance or commerce mail."
      );
      correctionMode =
        correctionMode === "neutral" ? "harmful_reinforcement" : "mixed";
    }
  }

  return {
    adjustedProfile,
    correctionMode,
    promoFatigueScore,
    transactionalProtectionScore,
    harmfulReinforcementScore,
    senderSampleCount: input.incidentHints.length,
    categorySampleCount: sameCategoryHints.length,
    trustDiscountApplied: trustDiscount,
    ruleHits,
    signals,
    rationale:
      rationales.length > 0
        ? rationales.join(" ")
        : "No sender-category learning correction applied.",
  };
}
