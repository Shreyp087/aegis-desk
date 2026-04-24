import { z } from "zod";

import {
  InboxDecisionActionEnum,
  InboxRiskLevelEnum,
  type InboxDecision,
} from "./decision";
import type { DecisionImportanceProfile } from "./importance";
import {
  InboxThreatTypeEnum,
  type InboxMailClass,
  type InboxThreatType,
} from "./schemas";
import type { InboxEventInference, InboxEventType } from "./eventTaxonomy";
import type { TemporalContextResult } from "./temporalContext.types";

const PriorityEnum = z.enum(["high", "medium", "low"]);
const TrustedActionEnum = z.enum(["allow", "escalate", "quarantine", "block"]);
const ActionRouteSourceEnum = z.enum(["routing_policy", "temporal_override"]);

export const AttentionPriorityLevelEnum = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);
export const SecuritySeverityLevelEnum = z.enum([
  "benign",
  "noisy",
  "suspicious",
  "harmful",
  "critical",
]);
export const ActionRouteEnum = z.enum([
  "suppress",
  "surface",
  "escalate",
  "quarantine",
  "block",
]);

export const InboxDecisionAxesSchema = z.object({
  attentionPriority: z.object({
    level: AttentionPriorityLevelEnum,
    score: z.number().min(0).max(100),
    legacyPriorityBand: PriorityEnum,
    attentionType: z.enum([
      "act_now",
      "verify_now",
      "review_later",
      "ignore_routine",
    ]),
    rationale: z.string(),
    drivers: z.array(z.string()).min(1).max(4),
  }),
  securitySeverity: z.object({
    level: SecuritySeverityLevelEnum,
    score: z.number().min(0).max(100),
    threatType: InboxThreatTypeEnum,
    legacyRiskLevel: InboxRiskLevelEnum,
    rationale: z.string(),
    drivers: z.array(z.string()).min(1).max(4),
  }),
  actionRoute: z.object({
    route: ActionRouteEnum,
    legacyRoutingAction: InboxDecisionActionEnum,
    trustedAction: TrustedActionEnum,
    source: ActionRouteSourceEnum,
    humanAttentionRequired: z.boolean(),
    rationale: z.string(),
  }),
});

export type AttentionPriorityLevel = z.infer<typeof AttentionPriorityLevelEnum>;
export type SecuritySeverityLevel = z.infer<typeof SecuritySeverityLevelEnum>;
export type ActionRoute = z.infer<typeof ActionRouteEnum>;
export type InboxDecisionAxes = z.infer<typeof InboxDecisionAxesSchema>;

type AdaptiveDecisionCalibration = {
  attentionHighFloor: number;
  attentionUrgentFloor: number;
  securitySuspiciousFloor: number;
  securityHarmfulFloor: number;
  surfaceAttentionFloor: number;
  escalateSecurityFloor: number;
  promoSuppressionSensitivity: number;
  mustNotMissFloor: number;
};

type SharedDecisionAxesArgs = {
  primaryCategory: string;
  priorityScore: number;
  priorityBand: "high" | "medium" | "low";
  mailClass: InboxMailClass;
  decisionImportance: DecisionImportanceProfile;
  trustedDecision: {
    action: "allow" | "escalate" | "quarantine" | "block";
    riskScore: number;
  };
  decision?: InboxDecision;
  legacyRiskLevel?: z.infer<typeof InboxRiskLevelEnum>;
  threatType: InboxThreatType;
  classifier: {
    probabilities: {
      harmful: number;
      actionable: number;
      informational: number;
      spam: number;
    };
  };
  extracted: {
    attachmentRiskScore: number;
    urls: string[];
    deadlines: string[];
  };
  riskTags: string[];
  subject: string;
  bodyPreview: string;
  temporalFlags?: string[];
  temporalContext?: TemporalContextResult;
  eventContext?: Pick<
    InboxEventInference,
    "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
  >;
  adaptiveCalibration?: AdaptiveDecisionCalibration;
};

type BuildDecisionAxesArgs = SharedDecisionAxesArgs & {
  decision: InboxDecision;
  precomputedAttentionPriority?: InboxDecisionAxes["attentionPriority"];
  precomputedSecuritySeverity?: InboxDecisionAxes["securitySeverity"];
};

type MessageIntent = {
  otpLike: boolean;
  passwordReset: boolean;
  purchaseConfirmation: boolean;
  jobApplicationUpdate: boolean;
  suspiciousLoginAlert: boolean;
  promotionalBulk: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deriveLegacyRiskLevelFromScore(
  riskScore: number
): z.infer<typeof InboxRiskLevelEnum> {
  if (riskScore >= 70) {
    return "high";
  }
  if (riskScore >= 40) {
    return "medium";
  }
  return "low";
}

/**
 * Checks whether the canonical event inference already tagged the email with one of the requested event types.
 *
 * Pipeline step: translation bridge from the event taxonomy into the three-axis decision model.
 * False-positive scenario addressed: reuses the structured event layer so safe operational mail is not reclassified by ad hoc text heuristics.
 */
function hasEventType(
  eventContext: SharedDecisionAxesArgs["eventContext"],
  values: InboxEventType[]
): boolean {
  if (!eventContext) {
    return false;
  }

  return (
    values.includes(eventContext.primaryEventType) ||
    eventContext.secondaryTags.some((tag) => values.includes(tag))
  );
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Adds one driver string if it is non-empty, unique, and the driver list is still below the cap.
 *
 * Pipeline step: shared by the three-axis translator while summarizing why each axis landed where it did.
 * False-positive scenario addressed: keeps one noisy heuristic from flooding the explanation and hiding the stronger deterministic evidence.
 */
function pushDriver(drivers: string[], value: string, max = 4): void {
  if (!value || drivers.includes(value) || drivers.length >= max) {
    return;
  }
  drivers.push(value);
}

/**
 * Detects a small set of safe-operational versus noisy-promotional intents from transient subject/body text.
 *
 * Pipeline step: translation layer only, using the already-parsed email content before serialization.
 * False-positive scenario addressed: lets the system keep OTPs, confirmations, and job updates high-attention without inflating their security severity.
 */
function deriveMessageIntent(args: SharedDecisionAxesArgs): MessageIntent {
  const preview = `${args.subject} ${args.bodyPreview.slice(0, 400)}`.toLowerCase();
  const primaryThreatEvent = args.eventContext?.primaryEventType === "phishing_or_impersonation";
  const otpLikeEvent = hasEventType(args.eventContext, ["auth_otp", "login_code"]);
  const passwordResetEvent = hasEventType(args.eventContext, [
    "password_reset",
    "password_changed",
    "account_recovery",
  ]);
  const purchaseEvent = hasEventType(args.eventContext, [
    "purchase_confirmed",
    "order_shipped",
    "receipt_invoice",
    "billing_issue",
    "payment_declined",
    "subscription_created",
    "subscription_renewal",
    "refund_update",
    "new_membership",
  ]);
  const jobEvent = hasEventType(args.eventContext, [
    "job_application_update",
    "interview_update",
    "interview_scheduled",
    "recruiter_reply",
  ]);
  const suspiciousLoginEvent = hasEventType(args.eventContext, [
    "login_alert",
    "new_device_signin",
    "security_warning",
  ]);
  const promotionalEvent = hasEventType(args.eventContext, [
    "promotional_commerce",
    "bulk_marketing",
    "newsletter",
  ]);

  const otpLike =
    !primaryThreatEvent &&
    (otpLikeEvent ||
      (/\b(otp|one[- ]time (code|passcode|password)|verification code|security code|login code|sign[- ]in code|mfa code|2fa code|passcode)\b/i.test(
        preview
      ) && !/\b(alert|attempt|suspicious|unusual|failed)\b/i.test(preview)));
  const passwordReset =
    !primaryThreatEvent &&
    (passwordResetEvent ||
      (/\b(password reset|reset your password|reset code|reset link|recover your account)\b/i.test(
        preview
      ) && !/\b(suspicious|unusual activity|failed sign[- ]in)\b/i.test(preview)));
  const purchaseConfirmation =
    !primaryThreatEvent &&
    (purchaseEvent ||
      /\b(order confirmation|order confirmed|purchase confirmation|receipt|thank you for your order|your order|tracking number|shipment|shipped)\b/i.test(
        preview
      ));
  const jobApplicationUpdate =
    !primaryThreatEvent &&
    (jobEvent ||
      /\b(application status|application update|job application|interview|recruiter|hiring team|candidate portal|position update)\b/i.test(
        preview
      ));
  const suspiciousLoginAlert =
    !primaryThreatEvent &&
    (suspiciousLoginEvent ||
      /\b(suspicious sign[- ]in|new sign[- ]in|sign[- ]in attempt|security alert|login alert|unusual activity|new device sign[- ]in)\b/i.test(
        preview
      ));
  const promotionalBulk =
    promotionalEvent ||
    args.primaryCategory === "newsletter" ||
    args.primaryCategory === "sales_marketing" ||
    /\b(sale|deal|discount|coupon|promo|limited time|shop now|flash sale|temu|% off)\b/i.test(
      preview
    );

  return {
    otpLike,
    passwordReset,
    purchaseConfirmation,
    jobApplicationUpdate,
    suspiciousLoginAlert,
    promotionalBulk,
  };
}

/**
 * Maps the legacy attention score/band into the new five-level attention model while preserving safe-operational urgency.
 *
 * Pipeline step: translation layer after scoring and before response serialization.
 * False-positive scenario addressed: stops harmful mail from automatically consuming the same attention budget as safe-but-important operational mail.
 */
export function deriveAttentionPriority(
  args: SharedDecisionAxesArgs
): InboxDecisionAxes["attentionPriority"] {
  const intent = deriveMessageIntent(args);
  const adaptiveCalibration = args.adaptiveCalibration;
  const drivers: string[] = [];
  const operationalAttention =
    intent.otpLike ||
    intent.passwordReset ||
    intent.purchaseConfirmation ||
    intent.jobApplicationUpdate ||
    intent.suspiciousLoginAlert;
  const containedThreat =
    (args.trustedDecision.action === "quarantine" ||
      args.trustedDecision.action === "block") &&
    !operationalAttention;
  const sensitiveAttention =
    args.eventContext?.sensitiveEvent.detected === true
      ? args.eventContext.sensitiveEvent.attentionBoost
      : 0;
  const sensitiveMustNotMiss =
    args.eventContext?.sensitiveEvent.detected === true
      ? args.eventContext.sensitiveEvent.mustNotMissScore
      : 0;
  const sensitiveTimeSensitivity =
    args.eventContext?.sensitiveEvent.detected === true
      ? args.eventContext.sensitiveEvent.timeSensitivity
      : "low";
  const temporalUrgencyBoost = args.temporalContext?.totalUrgencyDelta ?? 0;
  const temporalThreatBoost = args.temporalContext?.totalThreatDelta ?? 0;
  const unresolvedThreadDetected =
    args.temporalContext?.unresolvedThread.detected === true;
  const silenceBreakDetected =
    args.temporalContext?.silenceBreak.detected === true;
  const coordinatedAttack =
    args.temporalContext?.convergingSignal.campaignType === "coordinated_attack";
  const attentionHighFloor = adaptiveCalibration?.attentionHighFloor ?? 75;
  const attentionUrgentFloor = adaptiveCalibration?.attentionUrgentFloor ?? 88;
  const mustNotMissFloor = adaptiveCalibration?.mustNotMissFloor ?? 80;
  const promoSuppressionSensitivity =
    adaptiveCalibration?.promoSuppressionSensitivity ?? 50;
  const promoAttentionCap = clamp(
    Math.round(34 - (promoSuppressionSensitivity - 50) * 0.28),
    16,
    42
  );
  const mustNotMissHighFloor = clamp(
    Math.max(attentionHighFloor, mustNotMissFloor),
    68,
    92
  );
  const mustNotMissUrgentFloor = clamp(
    Math.max(attentionUrgentFloor - 4, mustNotMissFloor + 6),
    82,
    96
  );

  let level: AttentionPriorityLevel;
  let score = clamp(Math.round(args.priorityScore), 0, 100);

  if (containedThreat) {
    score = Math.min(score, 28);
    level = score < 20 ? "none" : "low";
  } else if (
    args.eventContext?.sensitiveEvent.detected &&
    args.eventContext.sensitiveEvent.family === "auth_flow"
  ) {
    score = Math.max(
      score,
      sensitiveTimeSensitivity === "expires_soon" ||
        sensitiveMustNotMiss >= mustNotMissUrgentFloor
        ? Math.max(92, attentionUrgentFloor)
        : mustNotMissHighFloor
    );
    level = "urgent";
  } else if (
    args.eventContext?.sensitiveEvent.detected &&
    [
      "account_security",
      "account_recovery",
      "career_workflow",
      "billing_lifecycle",
    ].includes(args.eventContext.sensitiveEvent.family ?? "")
  ) {
    score = Math.max(
      score,
      sensitiveMustNotMiss >= mustNotMissUrgentFloor ||
        sensitiveTimeSensitivity === "high"
        ? mustNotMissHighFloor
        : Math.max(72, mustNotMissHighFloor - 4)
    );
    level =
      sensitiveMustNotMiss >= mustNotMissUrgentFloor &&
      sensitiveTimeSensitivity === "high"
        ? "urgent"
        : "high";
  } else if (
    args.eventContext?.sensitiveEvent.detected &&
    [
      "commerce_transaction",
      "membership_lifecycle",
    ].includes(args.eventContext.sensitiveEvent.family ?? "")
  ) {
    score = Math.max(
      score,
      sensitiveMustNotMiss >= mustNotMissFloor
        ? Math.max(68, mustNotMissHighFloor - 8)
        : 68
    );
    level = "high";
  } else if (
    intent.promotionalBulk &&
    args.trustedDecision.action === "allow" &&
    args.decisionImportance.threatScore < 40
  ) {
    score = Math.min(score, promoAttentionCap);
    level = score < Math.max(14, promoAttentionCap - 8) ? "none" : "low";
  } else if (intent.otpLike || intent.passwordReset || intent.suspiciousLoginAlert) {
    score = Math.max(
      score,
      args.decisionImportance.urgencyScore >= 78
        ? attentionUrgentFloor
        : Math.max(72, attentionHighFloor)
    );
    level = score >= attentionUrgentFloor ? "urgent" : "high";
  } else if (intent.purchaseConfirmation || intent.jobApplicationUpdate) {
    score = Math.max(score, Math.max(68, attentionHighFloor - 6));
    level = score >= Math.max(86, attentionUrgentFloor - 2) ? "urgent" : "high";
  } else if (unresolvedThreadDetected) {
    score = Math.max(score, Math.max(76, attentionHighFloor));
    level =
      args.temporalContext?.unresolvedThread.routingOverride === "escalate"
        ? "urgent"
        : "high";
  } else if (coordinatedAttack && !containedThreat) {
    score = Math.max(score, Math.max(74, attentionHighFloor - 2));
    level = temporalThreatBoost >= 12 ? "high" : "medium";
  } else if (silenceBreakDetected) {
    score = Math.max(score, Math.min(72, Math.max(60, attentionHighFloor - 8)));
    level = score >= attentionHighFloor ? "high" : "medium";
  } else if (
    args.decisionImportance.attentionType === "act_now" &&
    (args.decisionImportance.urgencyScore >= 82 || score >= attentionUrgentFloor)
  ) {
    level = "urgent";
  } else if (
    args.decisionImportance.attentionType === "act_now" ||
    score >= attentionHighFloor
  ) {
    level = "high";
  } else if (
    args.decisionImportance.attentionType === "review_later" ||
    score >= 50
  ) {
    level = "medium";
  } else if (
    args.decisionImportance.attentionType === "ignore_routine" ||
    score < 18
  ) {
    level = "none";
  } else {
    level = "low";
  }

  pushDriver(drivers, `Urgency ${args.decisionImportance.urgencyScore}/100`);
  pushDriver(drivers, `Relevance ${args.decisionImportance.relevanceScore}/100`);
  if (args.eventContext) {
    pushDriver(drivers, `Event ${humanize(args.eventContext.primaryEventType)}`);
  }
  if (sensitiveAttention > 0) {
    pushDriver(drivers, `Sensitive-event boost ${sensitiveAttention}`);
  }
  if (sensitiveMustNotMiss > 0) {
    pushDriver(
      drivers,
      `Must-not-miss ${sensitiveMustNotMiss}/100 (${humanize(sensitiveTimeSensitivity)})`
    );
  }
  if (operationalAttention) {
    pushDriver(drivers, "Operational or personally relevant message");
  }
  if ((args.temporalFlags ?? []).some((flag) => flag.startsWith("temporal:"))) {
    if (unresolvedThreadDetected) {
      pushDriver(drivers, "Unresolved thread follow-up");
    } else if (coordinatedAttack) {
      pushDriver(
        drivers,
        `Cross-email convergence on ${humanize(
          args.temporalContext?.convergingSignal.clusterKey ?? "coordinated pattern"
        )}`
      );
    } else if (silenceBreakDetected) {
      pushDriver(
        drivers,
        args.temporalContext?.silenceBreak.novelSubjectPattern
          ? "Silence break plus new hashed subject pattern"
          : "Silence break from sender cadence"
      );
    } else {
      pushDriver(drivers, "Temporal context increased attention pressure");
    }
  }
  if (temporalUrgencyBoost > 0) {
    pushDriver(drivers, `Temporal urgency +${temporalUrgencyBoost}`);
  }
  if (intent.promotionalBulk) {
    pushDriver(
      drivers,
      `Promotional bulk pattern detected (suppression sensitivity ${promoSuppressionSensitivity}/100)`
    );
  }
  if (containedThreat) {
    pushDriver(drivers, `Danger is contained via ${args.trustedDecision.action.toUpperCase()}`);
  }

  let rationale =
    "User attention can stay low because the message looks routine and there is no strong personal action requirement.";
  if (containedThreat) {
    rationale =
      "The message appears dangerous, but user attention stays low because Aegis is already containing it via enforcement.";
  } else if (unresolvedThreadDetected && (level === "high" || level === "urgent")) {
    rationale =
      "User attention is high because this looks like a follow-up on an unresolved earlier item in the current batch.";
  } else if (coordinatedAttack && (level === "high" || level === "medium")) {
    rationale =
      "User attention increased because multiple domains converged on the same high-pressure theme inside the current batch.";
  } else if (silenceBreakDetected && level === "medium") {
    rationale =
      "User attention increased because the sender broke their normal timing pattern inside this batch.";
  } else if (
    args.eventContext?.sensitiveEvent.detected &&
    sensitiveMustNotMiss >= mustNotMissFloor &&
    (level === "high" || level === "urgent")
  ) {
    rationale =
      `User attention is ${level} because Aegis matched a high-confidence must-not-miss ${humanize(
        args.eventContext.sensitiveEvent.family ?? "event"
      )} pattern with ${humanize(sensitiveTimeSensitivity)} time sensitivity.`;
  } else if (intent.promotionalBulk && level !== "medium" && level !== "high" && level !== "urgent") {
    rationale =
      "User attention stays low because this looks like promotional bulk mail rather than a personally important task.";
  } else if (intent.otpLike || intent.passwordReset || intent.purchaseConfirmation) {
    rationale =
      "User attention is high because this is a safe operational account or transaction message that the person is likely waiting for.";
  } else if (intent.jobApplicationUpdate) {
    rationale =
      "User attention is high because this is a personally meaningful job application update even though it is not inherently dangerous.";
  } else if (intent.suspiciousLoginAlert) {
    rationale =
      "User attention is high because account access may need to be checked quickly even when the message itself is not confirmed malicious.";
  } else if (level === "urgent") {
    rationale =
      "User attention is urgent because urgency and relevance both clear the interruption threshold.";
  } else if (level === "high") {
    rationale =
      "User attention is high because the message is time-sensitive or clearly consequential for the person.";
  } else if (level === "medium") {
    rationale =
      "User attention is medium because the message appears relevant, but not disruptive enough to interrupt immediately.";
  }

  return {
    level,
    score,
    legacyPriorityBand: args.priorityBand,
    attentionType: args.decisionImportance.attentionType,
    rationale,
    drivers: drivers.slice(0, 4),
  };
}

/**
 * Maps legacy threat and enforcement signals into the new five-level security-severity model.
 *
 * Pipeline step: translation layer after scoring, classification, and trusted-action selection.
 * False-positive scenario addressed: separates harmless-but-important operational mail from genuinely dangerous content, and demotes routine promos to noisy instead of suspicious.
 */
export function deriveSecuritySeverity(
  args: SharedDecisionAxesArgs
): InboxDecisionAxes["securitySeverity"] {
  const intent = deriveMessageIntent(args);
  const adaptiveCalibration = args.adaptiveCalibration;
  const harmfulProbabilityPct = Math.round(args.classifier.probabilities.harmful * 100);
  const spamProbabilityPct = Math.round(args.classifier.probabilities.spam * 100);
  const urlsCount = args.extracted.urls.length;
  const explicitThreat = args.threatType !== "none" && args.threatType !== "unknown";
  const criticalTagHit = args.riskTags.some((tag) =>
    ["bec scam", "credential phishing", "malware risk", "impersonation"].includes(
      tag.toLowerCase()
    )
  );
  const sensitiveSecurityBoost =
    args.eventContext?.sensitiveEvent.detected === true
      ? args.eventContext.sensitiveEvent.securityBoost
      : 0;
  const temporalThreatBoost = args.temporalContext?.totalThreatDelta ?? 0;
  const convergingSignal = args.temporalContext?.convergingSignal;
  const coordinatedAttack = convergingSignal?.campaignType === "coordinated_attack";
  const suspiciousFloor = adaptiveCalibration?.securitySuspiciousFloor ?? 40;
  const harmfulFloor = adaptiveCalibration?.securityHarmfulFloor ?? 70;
  const promoSuppressionSensitivity =
    adaptiveCalibration?.promoSuppressionSensitivity ?? 50;

  let score = Math.round(
    args.decisionImportance.threatScore * 0.52 +
      harmfulProbabilityPct * 0.28 +
      args.decisionImportance.trustGapScore * 0.14 +
      args.extracted.attachmentRiskScore * 0.12 +
      Math.min(12, urlsCount * 3) +
      (explicitThreat ? 10 : 0) +
      (criticalTagHit ? 8 : 0) +
      sensitiveSecurityBoost +
      temporalThreatBoost * 1.6
  );

  if (args.trustedDecision.action === "block") {
    score = Math.max(score, 94);
  } else if (args.trustedDecision.action === "quarantine") {
    score = Math.max(score, 78);
  } else if (
    args.trustedDecision.action === "escalate" &&
    (explicitThreat || harmfulProbabilityPct >= 50)
  ) {
    score = Math.max(score, 56);
  }

  const safeOperational =
    intent.otpLike ||
    intent.passwordReset ||
    intent.purchaseConfirmation ||
    intent.jobApplicationUpdate;
  if (
    safeOperational &&
    !intent.suspiciousLoginAlert &&
    args.trustedDecision.action === "allow" &&
    harmfulProbabilityPct < 45 &&
    args.extracted.attachmentRiskScore < 25
  ) {
    score = Math.min(score, intent.purchaseConfirmation || intent.jobApplicationUpdate ? 18 : 22);
  }

  if (
    intent.suspiciousLoginAlert &&
    args.trustedDecision.action === "allow" &&
    harmfulProbabilityPct < 55
  ) {
    score = clamp(Math.max(score, 42), 42, 60);
  }
  if (
    args.eventContext?.sensitiveEvent.detected &&
    args.eventContext.sensitiveEvent.family === "account_security" &&
    args.trustedDecision.action === "allow"
  ) {
    score = clamp(Math.max(score, 46), 46, 68);
  }
  if (
    args.eventContext?.sensitiveEvent.detected &&
    args.eventContext.sensitiveEvent.family === "account_recovery" &&
    args.trustedDecision.action === "allow"
  ) {
    score = clamp(Math.max(score, 34), 34, 58);
  }

  if (
    intent.promotionalBulk &&
    args.trustedDecision.action === "allow" &&
    harmfulProbabilityPct < 35 &&
    args.decisionImportance.threatScore < 40
  ) {
    const promoSecurityCap = clamp(
      Math.round(30 - (promoSuppressionSensitivity - 50) * 0.12),
      18,
      34
    );
    score = Math.min(
      score,
      Math.max(20, spamProbabilityPct > 30 ? promoSecurityCap + 4 : promoSecurityCap)
    );
  }

  score = clamp(score, 0, 100);
  if (coordinatedAttack && convergingSignal) {
    score = Math.max(
      score,
      convergingSignal.threatElevation >= 12 ? harmfulFloor - 4 : suspiciousFloor + 8
    );
  }

  let level: SecuritySeverityLevel;
  if (
    safeOperational &&
    !intent.suspiciousLoginAlert &&
    args.trustedDecision.action === "allow" &&
    harmfulProbabilityPct < 45
  ) {
    level = "benign";
  } else if (args.trustedDecision.action === "block" || score >= 90) {
    level = "critical";
  } else if (args.trustedDecision.action === "quarantine" || score >= harmfulFloor) {
    level = "harmful";
  } else if (
    score >= suspiciousFloor ||
    intent.suspiciousLoginAlert ||
    explicitThreat ||
    coordinatedAttack
  ) {
    level = "suspicious";
  } else if (
    intent.promotionalBulk ||
    args.mailClass === "spam" ||
    spamProbabilityPct >= 40 ||
    args.decisionImportance.noiseScore >= 58
  ) {
    level = "noisy";
  } else {
    level = "benign";
  }

  const drivers: string[] = [];
  pushDriver(drivers, `Threat ${args.decisionImportance.threatScore}/100`);
  pushDriver(drivers, `Harmful probability ${harmfulProbabilityPct}%`);
  if (args.eventContext) {
    pushDriver(drivers, `Event ${humanize(args.eventContext.primaryEventType)}`);
  }
  if (sensitiveSecurityBoost > 0) {
    pushDriver(drivers, `Sensitive security boost ${sensitiveSecurityBoost}`);
  }
  if (temporalThreatBoost > 0) {
    pushDriver(drivers, `Temporal threat +${temporalThreatBoost}`);
  }
  if (explicitThreat) {
    pushDriver(drivers, `Threat type ${humanize(args.threatType)}`);
  }
  if (coordinatedAttack) {
    pushDriver(
      drivers,
      `Coordinated batch pattern ${humanize(convergingSignal?.clusterKey ?? "detected")}`
    );
  }
  if (intent.promotionalBulk && level === "noisy") {
    pushDriver(drivers, "Promotional bulk noise");
  }
  if (safeOperational && level === "benign") {
    pushDriver(drivers, "Safe operational message");
  }
  if (args.trustedDecision.action === "block" || args.trustedDecision.action === "quarantine") {
    pushDriver(drivers, `Enforced via ${args.trustedDecision.action.toUpperCase()}`);
  } else if (args.extracted.attachmentRiskScore >= 25) {
    pushDriver(drivers, `Attachment risk ${args.extracted.attachmentRiskScore}/100`);
  } else if (urlsCount > 0) {
    pushDriver(drivers, `${urlsCount} extracted URL(s)`);
  }

  let rationale = "Security severity is benign because the message looks operational or informational rather than dangerous.";
  if (level === "critical") {
    rationale =
      "Security severity is critical because strong threat evidence and enforcement signals align on a clearly dangerous message.";
  } else if (level === "harmful") {
    rationale =
      "Security severity is harmful because the message presents credible malicious behavior even if the user does not need to personally focus on it.";
  } else if (level === "suspicious") {
    rationale = coordinatedAttack
      ? "Security severity is suspicious because the current batch shows a coordinated pattern that warrants caution and review."
      : "Security severity is suspicious because the message has trust, access, or threat signals that warrant caution but not immediate containment.";
  } else if (level === "noisy") {
    rationale =
      "Security severity is noisy because the message is low-risk bulk or spam-like traffic rather than a dangerous attack.";
  }

  return {
    level,
    score,
    threatType: args.threatType,
    legacyRiskLevel:
      args.decision?.risk_level ??
      args.legacyRiskLevel ??
      deriveLegacyRiskLevelFromScore(args.trustedDecision.riskScore),
    rationale,
    drivers: drivers.slice(0, 4),
  };
}

/**
 * Builds the user-facing/system-facing action route from the existing routing decision plus trusted enforcement.
 *
 * Pipeline step: translation layer after routeInboxDecision() and any temporal override.
 * False-positive scenario addressed: makes suppression, surfacing, escalation, and containment explicit instead of inferring them from risk or attention alone.
 */
function buildActionRoute(args: BuildDecisionAxesArgs): InboxDecisionAxes["actionRoute"] {
  const temporalOverrideApplied = (args.temporalFlags ?? []).some((flag) =>
    flag.startsWith("temporal:routing:")
  );
  const coordinatedAttack =
    args.temporalContext?.convergingSignal.campaignType === "coordinated_attack";
  const unresolvedThreadDetected =
    args.temporalContext?.unresolvedThread.detected === true;
  const sensitiveSurfaceHint =
    args.eventContext?.sensitiveEvent.detected === true &&
    args.eventContext.sensitiveEvent.routeHint === "surface";
  const sensitiveEscalateHint =
    args.eventContext?.sensitiveEvent.detected === true &&
    args.eventContext.sensitiveEvent.routeHint === "escalate";
  const attention =
    args.precomputedAttentionPriority ?? deriveAttentionPriority(args);
  const severity =
    args.precomputedSecuritySeverity ?? deriveSecuritySeverity(args);
  const adaptiveCalibration = args.adaptiveCalibration;
  const surfaceAttentionFloor = adaptiveCalibration?.surfaceAttentionFloor ?? 58;
  const escalateSecurityFloor = adaptiveCalibration?.escalateSecurityFloor ?? 72;

  let route: ActionRoute;
  if (args.trustedDecision.action === "block") {
    route = "block";
  } else if (args.trustedDecision.action === "quarantine") {
    route = "quarantine";
  } else if (
    args.decision.final_action === "human_review" ||
    args.decision.final_action === "escalate" ||
    args.trustedDecision.action === "escalate"
  ) {
    route = "escalate";
  } else if (
    (attention.level === "none" || attention.level === "low") &&
    (severity.level === "benign" || severity.level === "noisy")
  ) {
    route = "suppress";
  } else {
    route = "surface";
  }

  if (
    route === "suppress" &&
    args.trustedDecision.action === "allow" &&
    attention.score >= surfaceAttentionFloor &&
    (severity.level === "benign" || severity.level === "noisy")
  ) {
    route = "surface";
  }
  if (
    route === "suppress" &&
    sensitiveSurfaceHint
  ) {
    route = "surface";
  }
  if (
    route === "surface" &&
    severity.score >= escalateSecurityFloor &&
    (severity.level === "suspicious" ||
      severity.level === "harmful" ||
      severity.level === "critical")
  ) {
    route = "escalate";
  }
  if (
    route === "surface" &&
    sensitiveEscalateHint &&
    (severity.level === "suspicious" ||
      severity.level === "harmful" ||
      severity.level === "critical")
  ) {
    route = "escalate";
  }
  if (
    route === "surface" &&
    coordinatedAttack &&
    (severity.level === "suspicious" ||
      severity.level === "harmful" ||
      severity.level === "critical")
  ) {
    route = "escalate";
  }

  let rationale = `Route ${route.toUpperCase()} derived from legacy routing ${args.decision.final_action.toUpperCase()} and trusted action ${args.trustedDecision.action.toUpperCase()}.`;
  if (route === "suppress") {
    rationale =
      "Route SUPPRESS because the message is neither dangerous enough nor important enough to warrant human attention.";
  } else if (route === "surface") {
    rationale =
      unresolvedThreadDetected
        ? "Route SURFACE because a follow-up on an unresolved thread should stay visible to the user."
        : sensitiveSurfaceHint
        ? "Route SURFACE because a high-confidence sensitive event should be shown directly even though the message is not primarily harmful."
        : "Route SURFACE because the message appears safe enough to show directly while still needing user attention.";
  } else if (route === "escalate") {
    rationale =
      temporalOverrideApplied
        ? `Route ESCALATE because temporal context forced the workflow upward. ${args.decision.reason}`
        : coordinatedAttack
          ? `Route ESCALATE because the current batch shows a coordinated ${humanize(
              args.temporalContext?.convergingSignal.clusterKey ?? "pattern"
            )} pattern with elevated security pressure.`
        : sensitiveEscalateHint
          ? "Route ESCALATE because a high-confidence sensitive account-security event also carried elevated security signals."
        : `Route ESCALATE because the workflow policy or trusted action requires review. ${args.decision.reason}`;
  } else if (route === "quarantine") {
    rationale =
      "Route QUARANTINE because the message is dangerous enough to contain before a person needs to deal with it.";
  } else if (route === "block") {
    rationale =
      "Route BLOCK because the message is critically dangerous and should not reach the user workflow.";
  }

  return {
    route,
    legacyRoutingAction: args.decision.final_action,
    trustedAction: args.trustedDecision.action,
    source: temporalOverrideApplied ? "temporal_override" : "routing_policy",
    humanAttentionRequired:
      route === "surface" || route === "escalate",
    rationale,
  };
}

/**
 * Builds the explicit three-axis decision model while preserving the existing scalar fields for compatibility.
 *
 * Pipeline step: response-serialization translation layer after scoring, false-positive correction, trusted action selection, and routing.
 * False-positive scenario addressed: keeps “important” and “dangerous” from collapsing into the same scalar, so the UI can show safe-urgent mail and harmful-contained mail correctly.
 */
export function buildDecisionAxes(args: BuildDecisionAxesArgs): InboxDecisionAxes {
  const attentionPriority =
    args.precomputedAttentionPriority ?? deriveAttentionPriority(args);
  const securitySeverity =
    args.precomputedSecuritySeverity ?? deriveSecuritySeverity(args);
  const actionRoute = buildActionRoute(args);

  return InboxDecisionAxesSchema.parse({
    attentionPriority,
    securitySeverity,
    actionRoute,
  });
}

/**
 * Produces a compact three-axis label for the evaluation log without changing the existing storage model.
 *
 * Pipeline step: feedback-loop compatibility bridge when serializing evaluation entries.
 * False-positive scenario addressed: preserves the richer decision shape for later tuning without persisting any raw email content.
 */
export function buildDecisionAxesFeedbackLabel(axes: InboxDecisionAxes): string {
  return [
    `attention:${axes.attentionPriority.level}`,
    `security:${axes.securitySeverity.level}`,
    `route:${axes.actionRoute.route}`,
    `trusted:${axes.actionRoute.trustedAction}`,
  ].join("|");
}
