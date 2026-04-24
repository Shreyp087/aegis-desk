import { z } from "zod";

import type { DecisionImportanceProfile } from "./importance";

export const InboxEventTypeEnum = z.enum([
  "auth_otp",
  "login_code",
  "login_alert",
  "password_reset",
  "password_changed",
  "account_recovery",
  "new_membership",
  "subscription_created",
  "new_device_signin",
  "purchase_confirmed",
  "order_shipped",
  "receipt_invoice",
  "billing_issue",
  "payment_declined",
  "subscription_renewal",
  "refund_update",
  "job_application_update",
  "interview_update",
  "interview_scheduled",
  "recruiter_reply",
  "deadline_action_required",
  "legal_notice",
  "calendar_or_schedule",
  "community_or_forum",
  "newsletter",
  "promotional_commerce",
  "bulk_marketing",
  "security_warning",
  "phishing_or_impersonation",
  "general_update",
]);

const EventAdjustmentSchema = z.object({
  urgencyDelta: z.number().int().min(-20).max(20),
  relevanceDelta: z.number().int().min(-20).max(20),
  noiseDelta: z.number().int().min(-20).max(20),
});

const SensitiveEventFamilyEnum = z.enum([
  "auth_flow",
  "account_security",
  "account_recovery",
  "commerce_transaction",
  "membership_lifecycle",
  "billing_lifecycle",
  "career_workflow",
]);

const SensitiveEventTimeSensitivityEnum = z.enum([
  "low",
  "medium",
  "high",
  "expires_soon",
]);

const SensitiveEventSignalSchema = z.object({
  detected: z.boolean(),
  family: SensitiveEventFamilyEnum.nullable(),
  confidence: z.number().min(0).max(100),
  attentionBoost: z.number().int().min(0).max(28),
  securityBoost: z.number().int().min(0).max(18),
  mustNotMissScore: z.number().int().min(0).max(100),
  timeSensitivity: SensitiveEventTimeSensitivityEnum,
  routeHint: z.enum(["surface", "escalate"]).nullable(),
  rationale: z.string(),
  guardrails: z.array(z.string()).max(6),
});

export const InboxEventInferenceSchema = z.object({
  primaryEventType: InboxEventTypeEnum,
  secondaryTags: z.array(InboxEventTypeEnum).max(6),
  confidence: z.number().min(0).max(100),
  rationale: z.string(),
  eventSignals: z.array(z.string()).max(10),
  attentionAdjustments: EventAdjustmentSchema,
  sensitiveEvent: SensitiveEventSignalSchema,
});

export type InboxEventType = z.infer<typeof InboxEventTypeEnum>;
export type InboxEventInference = z.infer<typeof InboxEventInferenceSchema>;
export type SensitiveEventFamily = z.infer<typeof SensitiveEventFamilyEnum>;
export type SensitiveEventTimeSensitivity = z.infer<
  typeof SensitiveEventTimeSensitivityEnum
>;

type EventInferenceArgs = {
  email: {
    subject: string;
    body: string;
    senderEmail: string;
    senderDomain: string;
    extracted: {
      deadlines: string[];
      moneyMentions: string[];
      urls: string[];
      attachments: string[];
      attachmentRiskScore: number;
    };
  };
  scoring: {
    primaryCategory: string;
    riskTags: string[];
    trustScore: number;
    reputationScore: number;
    promotional: {
      lowRiskPromotional: boolean;
      promotionalConfidence: number;
      promoUrgencyHits: number;
      senderPromoHints: number;
    };
    decisionImportance: DecisionImportanceProfile;
  };
};

type EventCandidate = {
  type: InboxEventType;
  score: number;
  reasons: string[];
};

/**
 * Clamps a numeric value into the inclusive min/max range.
 *
 * Pipeline step: shared numeric guard inside event inference and event-driven profile adjustments.
 * False-positive scenario addressed: keeps event confidence and attention adjustments bounded so one detector cannot overwhelm the downstream routing logic.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const AUTH_CODE_PHRASES = [
  "verification code",
  "security code",
  "one-time code",
  "one time code",
  "one-time passcode",
  "one time passcode",
  "otp",
  "2fa code",
  "mfa code",
];

const LOGIN_CODE_PHRASES = [
  "login code",
  "log in code",
  "sign-in code",
  "sign in code",
  "use this code to sign in",
  "complete sign-in",
  "complete login",
];

const LOGIN_ALERT_PHRASES = [
  "suspicious sign-in",
  "sign-in attempt",
  "login alert",
  "new sign-in",
  "unusual activity",
  "security alert",
];

const PASSWORD_RESET_PHRASES = [
  "password reset",
  "reset your password",
  "reset link",
  "reset code",
];

const PASSWORD_CHANGED_PHRASES = [
  "password changed",
  "your password was changed",
  "password updated",
];

const ACCOUNT_RECOVERY_PHRASES = [
  "account recovery",
  "recover your account",
  "recovery request",
  "recovery contact",
  "recovery attempt",
  "account locked",
  "locked out",
];

const NEW_MEMBERSHIP_PHRASES = [
  "welcome to",
  "membership confirmed",
  "membership activated",
  "membership has been created",
  "you joined",
  "new member",
];

const SUBSCRIPTION_CREATED_PHRASES = [
  "subscription created",
  "membership created",
  "trial started",
  "free trial started",
  "plan activated",
  "subscription activated",
  "plan started",
];

const NEW_DEVICE_PHRASES = [
  "new device",
  "new device sign-in",
  "signed in from a new device",
  "device was added",
];

const PURCHASE_CONFIRMED_PHRASES = [
  "order confirmed",
  "order has been confirmed",
  "your order has been confirmed",
  "purchase confirmation",
  "thank you for your order",
  "order receipt",
];

const ORDER_SHIPPED_PHRASES = [
  "order shipped",
  "shipped",
  "out for delivery",
  "tracking number",
  "package is on the way",
];

const RECEIPT_INVOICE_PHRASES = [
  "receipt",
  "invoice",
  "paid invoice",
  "payment receipt",
];

const PAYMENT_DECLINED_PHRASES = [
  "payment declined",
  "card declined",
  "payment was declined",
  "declined payment",
  "could not process your payment",
  "unable to process payment",
];

const BILLING_ISSUE_PHRASES = [
  "billing issue",
  "payment failed",
  "billing problem",
  "update your billing details",
  "billing details",
  "billing details issue",
];

const SUBSCRIPTION_RENEWAL_PHRASES = [
  "subscription renewal",
  "renews on",
  "subscription renewed",
  "renewal reminder",
];

const REFUND_UPDATE_PHRASES = [
  "refund issued",
  "refund processed",
  "refund update",
  "return completed",
];

const JOB_APPLICATION_PHRASES = [
  "application status",
  "application update",
  "job application",
  "candidate portal",
  "hiring team",
];

const INTERVIEW_UPDATE_PHRASES = [
  "interview update",
  "interview scheduled",
  "schedule an interview",
  "interview invitation",
  "meet with the team",
  "interview rescheduled",
  "next interview round",
  "schedule the next interview",
  "share your availability",
];

const INTERVIEW_SCHEDULE_PHRASES = [
  "interview scheduled",
  "schedule an interview",
  "interview invitation",
  "schedule the next interview",
  "share your availability",
];

const RECRUITER_REPLY_PHRASES = [
  "recruiter",
  "talent acquisition",
  "hiring manager replied",
  "thanks for applying",
  "your application",
  "thank you for your interest",
  "thank you for your time",
  "next step",
  "next steps",
  "position",
  "role",
];

const RECRUITING_DOMAIN_HINTS = [
  "greenhouse.io",
  "grnh.se",
  "lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "workday.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
  "teamtailor.com",
  "workablemail.com",
  "successfactors.com",
  "greenhouse-mail.io",
];

const RECRUITING_LOCAL_PART_HINTS = [
  "recruit",
  "talent",
  "career",
  "hiring",
  "jobs",
  "candidate",
  "interview",
];

const DEADLINE_PHRASES = [
  "action required",
  "respond by",
  "deadline",
  "due by",
  "submit by",
];

const LEGAL_NOTICE_PHRASES = [
  "legal notice",
  "terms update",
  "cease and desist",
  "governing law",
  "signature required",
];

const CALENDAR_PHRASES = [
  "calendar invite",
  "meeting",
  "reschedule",
  "availability",
  "schedule",
];

const COMMUNITY_PHRASES = [
  "forum",
  "community",
  "thread reply",
  "discussion",
  "mentioned you",
  "commented on",
];

const NEWSLETTER_PHRASES = [
  "newsletter",
  "weekly digest",
  "daily digest",
  "unsubscribe",
];

const PROMO_PHRASES = [
  "sale",
  "deal",
  "discount",
  "coupon",
  "promo",
  "shop now",
  "limited time",
  "flash sale",
];

const BULK_MARKETING_PHRASES = [
  "marketing",
  "special offer",
  "exclusive offer",
  "% off",
  "bogo",
];

const SECURITY_WARNING_PHRASES = [
  "security warning",
  "protect your account",
  "review your account",
  "account security",
];

const PHISHING_PHRASES = [
  "wire transfer",
  "bank details",
  "beneficiary",
  "gift card",
  "keep this confidential",
  "verify your account",
];

const HIGH_VALUE_EVENTS = new Set<InboxEventType>([
  "auth_otp",
  "login_code",
  "login_alert",
  "password_reset",
  "password_changed",
  "account_recovery",
  "new_membership",
  "subscription_created",
  "new_device_signin",
  "purchase_confirmed",
  "order_shipped",
  "receipt_invoice",
  "billing_issue",
  "payment_declined",
  "subscription_renewal",
  "refund_update",
  "job_application_update",
  "interview_update",
  "interview_scheduled",
  "recruiter_reply",
  "deadline_action_required",
  "legal_notice",
  "calendar_or_schedule",
  "security_warning",
]);

/**
 * Limits body inspection to a short preview and normalizes the subject/body into one comparison string.
 *
 * Pipeline step: event inference after parsing and before final routing.
 * False-positive scenario addressed: keeps event tagging deterministic and privacy-bounded while avoiding overfitting to long email bodies.
 */
function buildPreview(subject: string, body: string): string {
  return `${subject}\n${body.slice(0, 400)}`.toLowerCase();
}

/**
 * Returns true when any phrase in the provided set appears in the preview text.
 *
 * Pipeline step: shared matcher across structured event detectors.
 * False-positive scenario addressed: keeps detectors reviewable and composable instead of collapsing the taxonomy into one opaque regex.
 */
function hasAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

/**
 * Checks whether the sender domain matches any of the known domain hint fragments.
 *
 * Pipeline step: shared helper for structured event inference.
 * False-positive scenario addressed: lets deterministic detectors use provider identity cues without persisting or returning raw sender values.
 */
function hasSenderDomainHint(senderDomain: string, hints: readonly string[]): boolean {
  const normalizedDomain = senderDomain.trim().toLowerCase();
  return normalizedDomain.length > 0
    ? hints.some((hint) => normalizedDomain.includes(hint))
    : false;
}

/**
 * Checks whether the sender local-part contains a known workflow hint such as recruiting or careers.
 *
 * Pipeline step: shared helper for structured event inference.
 * False-positive scenario addressed: supports recruiter and workflow detections when the subject/body is short and avoids broad generic keyword matching.
 */
function hasSenderLocalPartHint(senderEmail: string, hints: readonly string[]): boolean {
  const localPart = senderEmail.split("@")[0]?.trim().toLowerCase() ?? "";
  return localPart.length > 0
    ? hints.some((hint) => localPart.includes(hint))
    : false;
}

/**
 * Adds or upgrades one event candidate while retaining all supporting reasons.
 *
 * Pipeline step: internal candidate aggregation for event inference.
 * False-positive scenario addressed: lets related detectors converge on one tag without duplicating or inflating the final event list.
 */
function pushCandidate(
  candidates: Map<InboxEventType, EventCandidate>,
  type: InboxEventType,
  score: number,
  reason: string
): void {
  const existing = candidates.get(type);
  if (!existing) {
    candidates.set(type, {
      type,
      score,
      reasons: [reason],
    });
    return;
  }

  existing.score = Math.max(existing.score, score);
  if (!existing.reasons.includes(reason)) {
    existing.reasons.push(reason);
  }
}

/**
 * Converts one inferred primary event into deterministic attention adjustments.
 *
 * Pipeline step: applied after event inference and before the later urgency/temporal/routing layers.
 * False-positive scenario addressed: boosts high-value life/account/workflow events without inflating promotional or attack tags into user-attention noise.
 */
function buildAttentionAdjustments(primaryEventType: InboxEventType): InboxEventInference["attentionAdjustments"] {
  switch (primaryEventType) {
    case "auth_otp":
    case "login_code":
    case "password_reset":
    case "account_recovery":
    case "password_changed":
    case "login_alert":
    case "new_device_signin":
    case "security_warning":
      return { urgencyDelta: 16, relevanceDelta: 18, noiseDelta: -10 };
    case "purchase_confirmed":
    case "order_shipped":
    case "receipt_invoice":
    case "billing_issue":
    case "payment_declined":
    case "subscription_created":
    case "subscription_renewal":
    case "refund_update":
    case "new_membership":
      return { urgencyDelta: 8, relevanceDelta: 16, noiseDelta: -8 };
    case "job_application_update":
    case "interview_update":
    case "interview_scheduled":
    case "recruiter_reply":
      return { urgencyDelta: 10, relevanceDelta: 20, noiseDelta: -10 };
    case "deadline_action_required":
    case "legal_notice":
    case "calendar_or_schedule":
      return { urgencyDelta: 14, relevanceDelta: 12, noiseDelta: -6 };
    case "community_or_forum":
      return { urgencyDelta: 0, relevanceDelta: 6, noiseDelta: 0 };
    case "newsletter":
      return { urgencyDelta: -2, relevanceDelta: -4, noiseDelta: 8 };
    case "promotional_commerce":
      return { urgencyDelta: -4, relevanceDelta: -10, noiseDelta: 14 };
    case "bulk_marketing":
      return { urgencyDelta: -6, relevanceDelta: -12, noiseDelta: 18 };
    case "phishing_or_impersonation":
      return { urgencyDelta: 0, relevanceDelta: 0, noiseDelta: 0 };
    case "general_update":
      return { urgencyDelta: 0, relevanceDelta: 0, noiseDelta: 0 };
    default:
      return { urgencyDelta: 0, relevanceDelta: 0, noiseDelta: 0 };
  }
}

/**
 * Builds the high-confidence sensitive-event signal for must-not-miss account, commerce, billing, membership, and career events.
 *
 * Pipeline step: runs immediately after canonical event inference and before decision-importance, decision-axis, and routing translation.
 * False-positive scenario addressed: raises attention for benign-but-important events without letting newsletters, promos, or generic noise inherit the same boost.
 */
function buildSensitiveEventSignal(args: {
  eventType: InboxEventType;
  secondaryTags: InboxEventType[];
  preview: string;
  hasCode: boolean;
  email: EventInferenceArgs["email"];
  scoring: EventInferenceArgs["scoring"];
}): z.infer<typeof SensitiveEventSignalSchema> {
  const guardrails: string[] = [];
  const lowRiskPromotional =
    args.scoring.promotional.lowRiskPromotional ||
    args.scoring.primaryCategory === "sales_marketing" ||
    args.scoring.primaryCategory === "newsletter";
  const elevatedSecurityContext =
    args.scoring.decisionImportance.threatScore >= 55 ||
    args.scoring.riskTags.some((tag) =>
      ["credential phishing", "bec scam", "impersonation", "malware risk"].includes(
        tag.toLowerCase()
      )
    );

  if (
    [
      "newsletter",
      "promotional_commerce",
      "bulk_marketing",
      "general_update",
      "phishing_or_impersonation",
    ].includes(args.eventType)
  ) {
    guardrails.push("non_sensitive_event_family");
    return SensitiveEventSignalSchema.parse({
      detected: false,
      family: null,
      confidence: 18,
      attentionBoost: 0,
      securityBoost: 0,
      mustNotMissScore: 0,
      timeSensitivity: "low",
      routeHint: null,
      rationale: "Primary event is not part of the must-not-miss sensitive-event families.",
      guardrails,
    });
  }

  if (
    lowRiskPromotional &&
    !["auth_otp", "login_code", "login_alert", "new_device_signin", "security_warning"].includes(
      args.eventType
    )
  ) {
    guardrails.push("promo_collision_guard");
    return SensitiveEventSignalSchema.parse({
      detected: false,
      family: null,
      confidence: 22,
      attentionBoost: 0,
      securityBoost: 0,
      mustNotMissScore: 0,
      timeSensitivity: "low",
      routeHint: null,
      rationale: "Promotional context was stronger than the candidate sensitive-event signal.",
      guardrails,
    });
  }

  let family: SensitiveEventFamily | null = null;
  let confidence = 0;
  let attentionBoost = 0;
  let securityBoost = 0;
  let mustNotMissScore = 0;
  let timeSensitivity: SensitiveEventTimeSensitivity = "low";
  let routeHint: "surface" | "escalate" | null = null;
  let rationale = "No sensitive-event boost was applied.";

  switch (args.eventType) {
    case "auth_otp":
    case "login_code":
      family = "auth_flow";
      confidence = args.hasCode ? 96 : 78;
      attentionBoost = args.hasCode ? 24 : 18;
      securityBoost = 0;
      mustNotMissScore = args.hasCode ? 96 : 82;
      timeSensitivity = "expires_soon";
      routeHint = "surface";
      rationale = "Authentication code patterns indicate a short-lived, must-not-miss sign-in event.";
      break;
    case "password_reset":
    case "password_changed":
    case "account_recovery":
      family = "account_recovery";
      confidence = hasAnyPhrase(args.preview, ACCOUNT_RECOVERY_PHRASES) ? 92 : 84;
      attentionBoost = 20;
      securityBoost =
        args.eventType === "password_changed" || args.eventType === "account_recovery" ? 10 : 8;
      mustNotMissScore =
        args.eventType === "password_changed" || args.eventType === "account_recovery" ? 90 : 86;
      timeSensitivity = "high";
      routeHint = elevatedSecurityContext ? "escalate" : "surface";
      rationale = "Account recovery or credential-change activity is important even when the message is not clearly malicious.";
      break;
    case "login_alert":
    case "new_device_signin":
    case "security_warning":
      family = "account_security";
      confidence =
        hasAnyPhrase(args.preview, LOGIN_ALERT_PHRASES) ||
        hasAnyPhrase(args.preview, NEW_DEVICE_PHRASES) ||
        hasAnyPhrase(args.preview, SECURITY_WARNING_PHRASES)
          ? 92
          : 82;
      attentionBoost = 20;
      securityBoost = 12;
      mustNotMissScore = 90;
      timeSensitivity = "high";
      routeHint = elevatedSecurityContext ? "escalate" : "surface";
      rationale = "Account-access anomaly signals can indicate takeover risk and should be surfaced even from trusted providers.";
      break;
    case "purchase_confirmed":
    case "order_shipped":
    case "receipt_invoice":
    case "refund_update":
      family = "commerce_transaction";
      confidence =
        args.email.extracted.moneyMentions.length > 0 ||
        hasAnyPhrase(args.preview, PURCHASE_CONFIRMED_PHRASES) ||
        hasAnyPhrase(args.preview, ORDER_SHIPPED_PHRASES)
          ? 90
          : 80;
      attentionBoost = 16;
      securityBoost = 0;
      mustNotMissScore =
        args.eventType === "purchase_confirmed" || args.eventType === "receipt_invoice"
          ? 84
          : 78;
      timeSensitivity = "medium";
      routeHint = "surface";
      rationale = "Transactional commerce updates are benign by default, but still important enough to surface clearly.";
      break;
    case "new_membership":
    case "subscription_created":
    case "subscription_renewal":
      family = "membership_lifecycle";
      confidence =
        hasAnyPhrase(args.preview, SUBSCRIPTION_CREATED_PHRASES) ||
        hasAnyPhrase(args.preview, NEW_MEMBERSHIP_PHRASES)
          ? 88
          : 80;
      attentionBoost = 16;
      securityBoost = 2;
      mustNotMissScore = args.eventType === "subscription_created" ? 82 : 76;
      timeSensitivity = args.eventType === "subscription_created" ? "high" : "medium";
      routeHint = "surface";
      rationale = "Membership or subscription lifecycle changes are user-relevant account events.";
      break;
    case "billing_issue":
    case "payment_declined":
      family = "billing_lifecycle";
      confidence =
        hasAnyPhrase(args.preview, PAYMENT_DECLINED_PHRASES) ||
        hasAnyPhrase(args.preview, BILLING_ISSUE_PHRASES)
          ? 92
          : 82;
      attentionBoost = 18;
      securityBoost = 4;
      mustNotMissScore = args.eventType === "payment_declined" ? 88 : 82;
      timeSensitivity = args.eventType === "payment_declined" ? "high" : "medium";
      routeHint = "surface";
      rationale = "Billing failures or declined payments are important account problems even when the message is not harmful.";
      break;
    case "job_application_update":
    case "interview_update":
    case "interview_scheduled":
    case "recruiter_reply":
      family = "career_workflow";
      confidence =
        args.eventType === "interview_update" || args.eventType === "interview_scheduled"
          ? 92
          : args.eventType === "recruiter_reply"
            ? 84
            : 88;
      attentionBoost = 18;
      securityBoost = 0;
      mustNotMissScore =
        args.eventType === "interview_update" || args.eventType === "interview_scheduled"
          ? 90
          : args.eventType === "recruiter_reply"
            ? 82
            : 86;
      timeSensitivity =
        args.eventType === "interview_update" || args.email.extracted.deadlines.length > 0
          ? "high"
          : "medium";
      routeHint = "surface";
      rationale = "Career workflow messages are life-relevant and should not be buried behind harm-based scoring.";
      break;
    default:
      break;
  }

  if (confidence < 70 || family === null) {
    guardrails.push("confidence_guard");
    return SensitiveEventSignalSchema.parse({
      detected: false,
      family,
      confidence: clamp(confidence, 0, 100),
      attentionBoost: 0,
      securityBoost: 0,
      mustNotMissScore: 0,
      timeSensitivity: "low",
      routeHint: null,
      rationale: family
        ? "Sensitive-event confidence did not clear the high-confidence threshold."
        : rationale,
      guardrails,
    });
  }

  if (args.scoring.decisionImportance.threatScore >= 78 && family !== "account_security") {
    guardrails.push("dominant_threat_guard");
    attentionBoost = Math.min(attentionBoost, 10);
    mustNotMissScore = Math.min(mustNotMissScore, 72);
  }

  return SensitiveEventSignalSchema.parse({
    detected: true,
    family,
    confidence: clamp(confidence, 0, 100),
    attentionBoost: clamp(attentionBoost, 0, 28),
    securityBoost: clamp(securityBoost, 0, 18),
    mustNotMissScore: clamp(mustNotMissScore, 0, 100),
    timeSensitivity,
    routeHint,
    rationale,
    guardrails,
  });
}

/**
 * Builds the canonical event inference for one email using deterministic structured detectors.
 *
 * Pipeline step: runs after parsing/base scoring and before later routing layers.
 * False-positive scenario addressed: separates life/account/workflow relevance from threat patterns so OTPs and receipts surface correctly while promos stay suppressed.
 */
export function inferInboxEvent(args: EventInferenceArgs): InboxEventInference {
  const preview = buildPreview(args.email.subject, args.email.body);
  const candidates = new Map<InboxEventType, EventCandidate>();
  const hasCode = /\b\d{4,8}\b/.test(preview);
  const recruitingSenderHint =
    hasSenderDomainHint(args.email.senderDomain, RECRUITING_DOMAIN_HINTS) ||
    hasSenderLocalPartHint(args.email.senderEmail, RECRUITING_LOCAL_PART_HINTS);
  const riskyTagHit = args.scoring.riskTags.some((tag) =>
    ["bec scam", "credential phishing", "malware risk", "impersonation", "invoice scam"].includes(
      tag.toLowerCase()
    )
  );
  const authCodeLike =
    hasCode &&
    (hasAnyPhrase(preview, LOGIN_CODE_PHRASES) || hasAnyPhrase(preview, AUTH_CODE_PHRASES));
  const accountWorkflowLike =
    authCodeLike ||
    hasAnyPhrase(preview, LOGIN_ALERT_PHRASES) ||
    hasAnyPhrase(preview, NEW_DEVICE_PHRASES) ||
    hasAnyPhrase(preview, SECURITY_WARNING_PHRASES) ||
    hasAnyPhrase(preview, PASSWORD_RESET_PHRASES) ||
    hasAnyPhrase(preview, PASSWORD_CHANGED_PHRASES) ||
    hasAnyPhrase(preview, ACCOUNT_RECOVERY_PHRASES);
  const commerceWorkflowLike =
    hasAnyPhrase(preview, PURCHASE_CONFIRMED_PHRASES) ||
    hasAnyPhrase(preview, ORDER_SHIPPED_PHRASES) ||
    hasAnyPhrase(preview, RECEIPT_INVOICE_PHRASES) ||
    hasAnyPhrase(preview, PAYMENT_DECLINED_PHRASES) ||
    hasAnyPhrase(preview, BILLING_ISSUE_PHRASES) ||
    hasAnyPhrase(preview, SUBSCRIPTION_CREATED_PHRASES) ||
    hasAnyPhrase(preview, SUBSCRIPTION_RENEWAL_PHRASES) ||
    hasAnyPhrase(preview, REFUND_UPDATE_PHRASES);
  const careerWorkflowLike =
    hasAnyPhrase(preview, INTERVIEW_UPDATE_PHRASES) ||
    hasAnyPhrase(preview, JOB_APPLICATION_PHRASES) ||
    hasAnyPhrase(preview, RECRUITER_REPLY_PHRASES);
  const safeOperationalPattern =
    (accountWorkflowLike || commerceWorkflowLike || careerWorkflowLike) &&
    args.scoring.decisionImportance.threatScore < 60 &&
    !riskyTagHit;
  const highThreat =
    args.scoring.primaryCategory.startsWith("scam_") ||
    (args.scoring.primaryCategory === "security_phishing" && !safeOperationalPattern) ||
    args.scoring.decisionImportance.threatScore >= 65 ||
    riskyTagHit;
  const trustedTransactionalSender =
    args.scoring.trustScore >= 55 &&
    args.scoring.reputationScore >= 55 &&
    args.scoring.decisionImportance.threatScore < 45;
  const promoLike =
    args.scoring.promotional.lowRiskPromotional ||
    args.scoring.primaryCategory === "sales_marketing" ||
    hasAnyPhrase(preview, PROMO_PHRASES);

  if (hasCode && hasAnyPhrase(preview, LOGIN_CODE_PHRASES)) {
    pushCandidate(candidates, "login_code", 94, "login code language with numeric code");
  }
  if (hasCode && hasAnyPhrase(preview, AUTH_CODE_PHRASES)) {
    pushCandidate(candidates, "auth_otp", 90, "authentication code language with numeric code");
  }

  if (hasAnyPhrase(preview, LOGIN_ALERT_PHRASES)) {
    pushCandidate(candidates, "login_alert", 88, "login alert language");
  }
  if (hasAnyPhrase(preview, NEW_DEVICE_PHRASES)) {
    pushCandidate(candidates, "new_device_signin", 86, "new device sign-in language");
  }
  if (hasAnyPhrase(preview, SECURITY_WARNING_PHRASES)) {
    pushCandidate(candidates, "security_warning", 80, "security warning language");
  }

  if (hasAnyPhrase(preview, PASSWORD_RESET_PHRASES)) {
    pushCandidate(candidates, "password_reset", 88, "password reset language");
  }
  if (hasAnyPhrase(preview, PASSWORD_CHANGED_PHRASES)) {
    pushCandidate(candidates, "password_changed", 86, "password changed language");
  }
  if (hasAnyPhrase(preview, ACCOUNT_RECOVERY_PHRASES)) {
    pushCandidate(candidates, "account_recovery", 90, "account recovery language");
  }
  if (hasAnyPhrase(preview, NEW_MEMBERSHIP_PHRASES)) {
    pushCandidate(candidates, "new_membership", 76, "new membership or welcome language");
  }
  if (hasAnyPhrase(preview, SUBSCRIPTION_CREATED_PHRASES)) {
    pushCandidate(candidates, "subscription_created", 82, "subscription creation or trial-start language");
  }

  if (hasAnyPhrase(preview, PURCHASE_CONFIRMED_PHRASES)) {
    pushCandidate(candidates, "purchase_confirmed", 84, "purchase confirmation language");
  }
  if (hasAnyPhrase(preview, ORDER_SHIPPED_PHRASES)) {
    pushCandidate(candidates, "order_shipped", 84, "shipping or tracking language");
  }
  if (
    hasAnyPhrase(preview, RECEIPT_INVOICE_PHRASES) ||
    (args.email.extracted.moneyMentions.length > 0 &&
      args.scoring.primaryCategory === "finance_payment")
  ) {
    pushCandidate(
      candidates,
      "receipt_invoice",
      trustedTransactionalSender ? 82 : 68,
      "receipt or invoice language"
    );
  }
  if (hasAnyPhrase(preview, PAYMENT_DECLINED_PHRASES)) {
    pushCandidate(candidates, "payment_declined", 86, "payment declined language");
  }
  if (hasAnyPhrase(preview, BILLING_ISSUE_PHRASES)) {
    pushCandidate(candidates, "billing_issue", 82, "billing issue language");
  }
  if (hasAnyPhrase(preview, SUBSCRIPTION_RENEWAL_PHRASES)) {
    pushCandidate(candidates, "subscription_renewal", 78, "subscription renewal language");
  }
  if (hasAnyPhrase(preview, REFUND_UPDATE_PHRASES)) {
    pushCandidate(candidates, "refund_update", 80, "refund update language");
  }

  if (hasAnyPhrase(preview, INTERVIEW_UPDATE_PHRASES)) {
    pushCandidate(candidates, "interview_update", 90, "interview update language");
  }
  if (hasAnyPhrase(preview, INTERVIEW_SCHEDULE_PHRASES)) {
    pushCandidate(candidates, "interview_scheduled", 90, "interview scheduling language");
  }
  if (hasAnyPhrase(preview, JOB_APPLICATION_PHRASES)) {
    pushCandidate(candidates, "job_application_update", 84, "job application language");
  }
  if (hasAnyPhrase(preview, RECRUITER_REPLY_PHRASES)) {
    pushCandidate(candidates, "recruiter_reply", 82, "recruiter reply language");
  }
  if (recruitingSenderHint && hasAnyPhrase(preview, RECRUITER_REPLY_PHRASES)) {
    pushCandidate(candidates, "recruiter_reply", 86, "recruiting sender matched a generic recruiter response");
  }
  if (
    recruitingSenderHint &&
    hasAnyPhrase(preview, ["application", "candidate", "position", "role", "next step", "next steps"])
  ) {
    pushCandidate(candidates, "job_application_update", 80, "recruiting sender with application workflow language");
  }
  if (
    recruitingSenderHint &&
    hasAnyPhrase(preview, ["availability", "schedule", "meeting", "interview", "next round"])
  ) {
    pushCandidate(candidates, "interview_update", 84, "recruiting sender with interview coordination language");
    pushCandidate(candidates, "interview_scheduled", 84, "recruiting sender with interview coordination language");
  }

  if (
    args.email.extracted.deadlines.length > 0 ||
    hasAnyPhrase(preview, DEADLINE_PHRASES)
  ) {
    pushCandidate(candidates, "deadline_action_required", 76, "deadline or action-required language");
  }
  if (hasAnyPhrase(preview, LEGAL_NOTICE_PHRASES) || args.scoring.primaryCategory === "legal_contract") {
    pushCandidate(candidates, "legal_notice", 82, "legal or notice language");
  }
  if (
    hasAnyPhrase(preview, CALENDAR_PHRASES) ||
    args.scoring.primaryCategory === "deadline_scheduling"
  ) {
    pushCandidate(candidates, "calendar_or_schedule", 72, "calendar or scheduling language");
  }

  if (hasAnyPhrase(preview, COMMUNITY_PHRASES)) {
    pushCandidate(candidates, "community_or_forum", 66, "community or forum language");
  }
  if (
    hasAnyPhrase(preview, NEWSLETTER_PHRASES) ||
    args.scoring.primaryCategory === "newsletter"
  ) {
    pushCandidate(candidates, "newsletter", 68, "newsletter language");
  }
  if (promoLike) {
    pushCandidate(
      candidates,
      "promotional_commerce",
      args.scoring.promotional.lowRiskPromotional ? 78 : 70,
      "promotional commerce language"
    );
  }
  if (
    hasAnyPhrase(preview, BULK_MARKETING_PHRASES) ||
    args.scoring.promotional.senderPromoHints >= 2 ||
    args.scoring.promotional.promotionalConfidence >= 2
  ) {
    pushCandidate(candidates, "bulk_marketing", 74, "bulk marketing indicators");
  }

  if ((highThreat || hasAnyPhrase(preview, PHISHING_PHRASES)) && !safeOperationalPattern) {
    pushCandidate(
      candidates,
      "phishing_or_impersonation",
      highThreat ? 96 : 82,
      "phishing, impersonation, or fraud indicators"
    );
  }

  if (candidates.size === 0) {
    return InboxEventInferenceSchema.parse({
      primaryEventType: "general_update",
      secondaryTags: [],
      confidence: 25,
      rationale: "No strong life/account/workflow event pattern detected.",
      eventSignals: ["event:general_update"],
      attentionAdjustments: buildAttentionAdjustments("general_update"),
      sensitiveEvent: {
        detected: false,
        family: null,
        confidence: 15,
        attentionBoost: 0,
        securityBoost: 0,
        mustNotMissScore: 0,
        timeSensitivity: "low",
        routeHint: null,
        rationale: "No high-confidence sensitive-event pattern detected.",
        guardrails: ["no_sensitive_candidate"],
      },
    });
  }

  const ordered = [...candidates.values()].sort((a, b) => b.score - a.score);
  let primary = ordered[0];
  const phishingCandidate = candidates.get("phishing_or_impersonation");
  if (
    phishingCandidate &&
    phishingCandidate.score >= 85 &&
    args.scoring.decisionImportance.threatScore >= 55
  ) {
    primary = phishingCandidate;
  }

  const secondaryTags = ordered
    .filter(
      (candidate) =>
        candidate.type !== primary.type &&
        candidate.score >=
          (primary.type === "phishing_or_impersonation"
            ? 60
            : Math.max(58, primary.score - 18))
    )
    .slice(0, 4)
    .map((candidate) => candidate.type);
  const secondScore =
    ordered.find((candidate) => candidate.type !== primary.type)?.score ?? 0;
  const confidence = clamp(
    Math.round(primary.score - secondScore * 0.2 + (secondaryTags.length === 0 ? 6 : 0)),
    30,
    99
  );
  const rationale = `${primary.type} selected because ${primary.reasons[0]}.`;
  const eventSignals = Array.from(
    new Set([
      `event:primary:${primary.type}`,
      ...secondaryTags.map((tag) => `event:tag:${tag}`),
      ...(HIGH_VALUE_EVENTS.has(primary.type) ? ["event:high_value"] : []),
    ])
  ).slice(0, 10);
  const sensitiveEvent = buildSensitiveEventSignal({
    eventType: primary.type,
    secondaryTags,
    preview,
    hasCode,
    email: args.email,
    scoring: args.scoring,
  });
  const enrichedSignals = Array.from(
    new Set([
      ...eventSignals,
      ...(sensitiveEvent.detected
        ? [
            `event:sensitive:${sensitiveEvent.family}`,
            `event:sensitive_attention_boost:${sensitiveEvent.attentionBoost}`,
            `event:sensitive_must_not_miss:${sensitiveEvent.mustNotMissScore}`,
            `event:sensitive_time:${sensitiveEvent.timeSensitivity}`,
            ...(sensitiveEvent.securityBoost > 0
              ? [`event:sensitive_security_boost:${sensitiveEvent.securityBoost}`]
              : []),
          ]
        : []),
    ])
  ).slice(0, 10);

  return InboxEventInferenceSchema.parse({
    primaryEventType: primary.type,
    secondaryTags,
    confidence,
    rationale,
    eventSignals: enrichedSignals,
    attentionAdjustments: buildAttentionAdjustments(primary.type),
    sensitiveEvent,
  });
}

/**
 * Applies the event-derived relevance, urgency, and noise adjustments to the current decision-importance profile.
 *
 * Pipeline step: runs after event inference and before urgency prediction, temporal context, and final routing.
 * False-positive scenario addressed: makes high-value life/account/workflow events more likely to surface while preserving the existing threat score and security protections.
 */
export function applyEventDecisionAdjustments(
  profile: DecisionImportanceProfile,
  event: InboxEventInference
): DecisionImportanceProfile {
  return {
    ...profile,
    urgencyScore: clamp(
      profile.urgencyScore + event.attentionAdjustments.urgencyDelta,
      0,
      100
    ),
    relevanceScore: clamp(
      profile.relevanceScore + event.attentionAdjustments.relevanceDelta,
      0,
      100
    ),
    noiseScore: clamp(
      profile.noiseScore + event.attentionAdjustments.noiseDelta,
      0,
      100
    ),
  };
}

/**
 * Applies the high-confidence sensitive-event boosts to attention and security dimensions without collapsing them into a single risk scalar.
 *
 * Pipeline step: runs after canonical event adjustments and before urgency prediction, temporal context, and the final three-axis translation.
 * False-positive scenario addressed: keeps must-not-miss benign events surfaced even when classic threat scoring is low, while only adding security lift for account-takeover style events.
 */
export function applySensitiveEventBoosts(
  profile: DecisionImportanceProfile,
  event: InboxEventInference
): DecisionImportanceProfile {
  if (!event.sensitiveEvent.detected) {
    return profile;
  }

  const timeUrgencyBonus =
    event.sensitiveEvent.timeSensitivity === "expires_soon"
      ? 4
      : event.sensitiveEvent.timeSensitivity === "high"
        ? 2
        : event.sensitiveEvent.timeSensitivity === "medium"
          ? 1
          : 0;
  const urgencyDelta = clamp(
    Math.round(
      event.sensitiveEvent.attentionBoost * 0.6 +
        event.sensitiveEvent.mustNotMissScore * 0.04 +
        timeUrgencyBonus
    ),
    0,
    24
  );
  const relevanceDelta = clamp(
    Math.round(
      event.sensitiveEvent.attentionBoost * 0.5 +
        event.sensitiveEvent.mustNotMissScore * 0.03
    ),
    0,
    22
  );
  const noiseDelta = clamp(
    Math.round(
      event.sensitiveEvent.attentionBoost * 0.35 +
        event.sensitiveEvent.mustNotMissScore * 0.02
    ),
    0,
    18
  );

  return {
    ...profile,
    threatScore: clamp(
      profile.threatScore + event.sensitiveEvent.securityBoost,
      0,
      100
    ),
    urgencyScore: clamp(profile.urgencyScore + urgencyDelta, 0, 100),
    relevanceScore: clamp(profile.relevanceScore + relevanceDelta, 0, 100),
    noiseScore: clamp(profile.noiseScore - noiseDelta, 0, 100),
  };
}
