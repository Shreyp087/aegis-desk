import { z } from "zod";

import {
  ActionRouteEnum,
  AttentionPriorityLevelEnum,
  SecuritySeverityLevelEnum,
} from "./decisionAxes";
import { InboxEventTypeEnum, type InboxEventInference } from "./eventTaxonomy";
import type { UrgencyPredictorResult } from "./urgencyPredictor";
import type { TemporalContextResult } from "./temporalContext.types";

export const UserActionNeededEnum = z.enum(["yes", "no", "maybe"]);
export const CapsuleConfidenceLabelEnum = z.enum(["high", "medium", "low"]);

export const DecisionCapsuleSchema = z.object({
  headline: z.string(),
  primaryEventType: InboxEventTypeEnum,
  eventType: InboxEventTypeEnum,
  attentionPriority: AttentionPriorityLevelEnum,
  securitySeverity: SecuritySeverityLevelEnum,
  actionRoute: ActionRouteEnum,
  userActionNeeded: UserActionNeededEnum,
  expiresOrDeadline: z.string().nullable(),
  sensitivityFlags: z.array(z.string()).max(8),
  safeNextStep: z.string(),
  shortRationale: z.string(),
  confidenceNotes: z.array(z.string()).max(5),
  confidenceLabel: CapsuleConfidenceLabelEnum,
  confidenceNote: z.string().nullable(),
});

export type DecisionCapsule = z.infer<typeof DecisionCapsuleSchema>;

type BuildDecisionCapsuleArgs = {
  eventContext: Pick<
    InboxEventInference,
    "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
  >;
  attentionPriority: DecisionCapsule["attentionPriority"];
  securitySeverity: DecisionCapsule["securitySeverity"];
  actionRoute: z.infer<typeof ActionRouteEnum>;
  uncertainty: {
    score: number;
  };
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
    attachmentRiskScore: number;
  };
  temporalFlags?: string[];
  guardrailHits?: string[];
  falsePositiveGuard?: {
    guardActivated: boolean;
    correctionRules: string[];
    correctionReasons: string[];
  };
  temporalContext?: Pick<
    TemporalContextResult,
    | "dominantTemporalSignal"
    | "explanationNotes"
    | "routingOverride"
    | "totalUrgencyDelta"
    | "totalThreatDelta"
  >;
  urgencyPrediction?: Pick<
    UrgencyPredictorResult,
    "temporalContext" | "predictionConfidence" | "predictionFactors" | "urgencyDelta"
  >;
};

type CapsuleConfidence = {
  label: DecisionCapsule["confidenceLabel"];
  note: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isAccountSecurityEvent(eventType: DecisionCapsule["primaryEventType"]): boolean {
  return [
    "auth_otp",
    "login_code",
    "login_alert",
    "password_reset",
    "password_changed",
    "account_recovery",
    "new_device_signin",
    "security_warning",
  ].includes(eventType);
}

function isCommerceEvent(eventType: DecisionCapsule["primaryEventType"]): boolean {
  return [
    "purchase_confirmed",
    "order_shipped",
    "receipt_invoice",
    "billing_issue",
    "payment_declined",
    "subscription_created",
    "subscription_renewal",
    "refund_update",
    "new_membership",
  ].includes(eventType);
}

function isWorkflowEvent(eventType: DecisionCapsule["primaryEventType"]): boolean {
  return [
    "job_application_update",
    "interview_update",
    "interview_scheduled",
    "recruiter_reply",
    "deadline_action_required",
    "legal_notice",
    "calendar_or_schedule",
  ].includes(eventType);
}

/**
 * Produces the lead line of the decision capsule using only canonical event types.
 *
 * Pipeline step: final decision summary builder after routing is known.
 * False-positive scenario addressed: prevents generic, content-heavy summaries by forcing one deterministic event-oriented headline.
 */
function buildHeadline(args: BuildDecisionCapsuleArgs): string {
  if (
    (args.actionRoute === "quarantine" || args.actionRoute === "block") &&
    (args.securitySeverity === "harmful" || args.securitySeverity === "critical")
  ) {
    return args.actionRoute === "block"
      ? "Dangerous message already blocked"
      : "Dangerous message already quarantined";
  }

  const eventType = args.eventContext.primaryEventType;
  switch (eventType) {
    case "auth_otp":
      return "One-time authentication code";
    case "login_code":
      return "Login code for your account";
    case "login_alert":
      return "Account login alert";
    case "password_reset":
      return "Password reset message";
    case "password_changed":
      return "Password change confirmation";
    case "account_recovery":
      return "Account recovery message";
    case "new_membership":
      return "New membership or account change";
    case "subscription_created":
      return "Subscription or trial created";
    case "new_device_signin":
      return "New device sign-in alert";
    case "purchase_confirmed":
      return "Purchase confirmed on your account";
    case "order_shipped":
      return "Order shipment update";
    case "receipt_invoice":
      return "Receipt or invoice update";
    case "billing_issue":
      return "Billing issue on your account";
    case "payment_declined":
      return "Payment declined on your account";
    case "subscription_renewal":
      return "Subscription renewal update";
    case "refund_update":
      return "Refund update";
    case "job_application_update":
      return "Job application update";
    case "interview_update":
      return "Interview update";
    case "interview_scheduled":
      return "Interview scheduling update";
    case "recruiter_reply":
      return "Recruiter reply";
    case "deadline_action_required":
      return "Action-required deadline update";
    case "legal_notice":
      return "Legal or policy notice";
    case "calendar_or_schedule":
      return "Calendar or scheduling update";
    case "community_or_forum":
      return "Community or forum activity";
    case "newsletter":
      return "Newsletter update";
    case "promotional_commerce":
      return "Promotional commerce mail";
    case "bulk_marketing":
      return "Bulk marketing email";
    case "security_warning":
      return "Security warning for your account";
    case "phishing_or_impersonation":
      return "Potential phishing or impersonation attempt";
    default:
      return "General account or workflow update";
  }
}

/**
 * Converts event confidence and uncertainty into a structured capsule confidence label.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: makes low-confidence interpretations explicit instead of presenting a shaky summary as certain.
 */
function buildCapsuleConfidence(args: BuildDecisionCapsuleArgs): CapsuleConfidence {
  const score = Math.round(
    clamp(
      args.eventContext.confidence * 0.65 + (100 - args.uncertainty.score * 100) * 0.35,
      0,
      100
    )
  );
  const adjustedScore =
    args.eventContext.primaryEventType === "general_update" ? score - 10 : score;

  if (adjustedScore < 45) {
    return {
      label: "low",
      note: "Low confidence capsule; review the raw message if it affects a real account or workflow.",
    };
  }
  if (adjustedScore < 75) {
    return {
      label: "medium",
      note: null,
    };
  }

  return {
      label: "high",
      note: null,
    };
}

/**
 * Builds a bounded list of confidence and decision notes using uncertainty, temporal context, guardrails, and sensitive-event metadata.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: makes score corrections and contextual boosts explicit so the capsule stays auditable instead of looking like a generic summary.
 */
function buildConfidenceNotes(
  args: BuildDecisionCapsuleArgs,
  confidence: CapsuleConfidence
): string[] {
  const notes: string[] = [];

  if (confidence.note) {
    notes.push(confidence.note);
  }

  if (
    args.eventContext.sensitiveEvent.detected &&
    args.eventContext.sensitiveEvent.mustNotMissScore >= 80
  ) {
    notes.push(
      `High-confidence must-not-miss ${args.eventContext.sensitiveEvent.family?.replace(/_/g, " ")} signal with ${args.eventContext.sensitiveEvent.timeSensitivity.replace(/_/g, " ")} time sensitivity.`
    );
  }

  if ((args.temporalFlags ?? []).includes("temporal:unresolved_thread")) {
    notes.push("Temporal context indicates this is a follow-up on an already active thread.");
  } else if ((args.temporalFlags ?? []).includes("temporal:silence_break")) {
    notes.push("Temporal context increased attention because this breaks the sender's normal pattern.");
  } else if (
    (args.temporalFlags ?? []).some((flag) => flag.startsWith("temporal:converging:"))
  ) {
    notes.push("Temporal context found related signals elsewhere in the current batch.");
  }

  if ((args.temporalFlags ?? []).some((flag) => flag.startsWith("temporal:routing:"))) {
    notes.push("Temporal context elevated the route for this message.");
  }

  const temporalExplanation = args.temporalContext?.explanationNotes.find(
    (note) => note.trim().length > 0
  );
  if (temporalExplanation) {
    notes.push(temporalExplanation);
  }

  const patternFactor = args.urgencyPrediction?.predictionFactors.find(
    (factor) =>
      factor.factor === "P3_conversation_gap" ||
      factor.factor === "P4_subject_trajectory"
  );
  if (patternFactor) {
    notes.push(patternFactor.rationale);
  }

  if (args.falsePositiveGuard?.guardActivated) {
    notes.push("False-positive guardrails adjusted this decision before surfacing it.");
  }

  if ((args.guardrailHits ?? []).includes("learning_transactional_protection")) {
    notes.push("Transactional protection prevented promo-noise learning from burying this message.");
  } else if ((args.guardrailHits ?? []).includes("learning_promo_fatigue")) {
    notes.push("Promo-fatigue learning reinforced suppression for repeated low-value marketing patterns.");
  }

  return uniqueStrings(notes).slice(0, 5);
}

/**
 * Derives whether the user clearly needs to act, does not need to act, or may need to decide based on context.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: keeps “dangerous” and “important” separate by allowing contained threats to require no user action while safe operational mail can still require review.
 */
function buildUserActionNeeded(args: BuildDecisionCapsuleArgs): DecisionCapsule["userActionNeeded"] {
  if (args.actionRoute === "quarantine" || args.actionRoute === "block") {
    return "no";
  }
  if (
    args.actionRoute === "suppress" &&
    (args.attentionPriority === "none" || args.attentionPriority === "low")
  ) {
    return "no";
  }
  if (
    [
      "job_application_update",
      "interview_update",
      "interview_scheduled",
      "recruiter_reply",
      "deadline_action_required",
      "legal_notice",
      "calendar_or_schedule",
    ].includes(args.eventContext.primaryEventType)
  ) {
    return "yes";
  }
  if (
    [
      "auth_otp",
      "login_code",
      "login_alert",
      "password_reset",
      "password_changed",
      "account_recovery",
      "new_device_signin",
      "security_warning",
      "purchase_confirmed",
      "order_shipped",
      "receipt_invoice",
      "billing_issue",
      "payment_declined",
      "subscription_created",
      "subscription_renewal",
      "refund_update",
      "new_membership",
      "phishing_or_impersonation",
    ].includes(args.eventContext.primaryEventType)
  ) {
    return "maybe";
  }

  return args.attentionPriority === "high" || args.attentionPriority === "urgent"
    ? "yes"
    : "no";
}

/**
 * Produces a bounded time-sensitivity string without inventing precise dates or codes.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: communicates urgency safely by reusing extracted deadlines or controlled event-based timing labels only.
 */
function buildExpiresOrDeadline(args: BuildDecisionCapsuleArgs): string | null {
  const extractedDeadline = args.extracted.deadlines.find((value) => value.trim().length > 0);
  if (extractedDeadline) {
    return extractedDeadline.trim();
  }

  if (args.eventContext.sensitiveEvent.detected) {
    if (args.eventContext.sensitiveEvent.timeSensitivity === "expires_soon") {
      return "Expires soon";
    }
    if (
      args.eventContext.sensitiveEvent.timeSensitivity === "high" &&
      (args.temporalFlags ?? []).includes("temporal:unresolved_thread")
    ) {
      return "Time-sensitive follow-up";
    }
  }

  switch (args.eventContext.primaryEventType) {
    case "password_reset":
    case "account_recovery":
    case "login_alert":
    case "new_device_signin":
    case "security_warning":
      return args.attentionPriority === "high" || args.attentionPriority === "urgent"
        ? "Review soon if unexpected"
        : null;
    default:
      return null;
  }
}

/**
 * Builds the structured sensitivity flags for the capsule using event, severity, and extracted signal data.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: keeps the capsule explainable and bounded while exposing the specific angle that makes the message sensitive.
 */
function buildSensitivityFlags(
  args: BuildDecisionCapsuleArgs,
  confidence: CapsuleConfidence
): string[] {
  const flags: string[] = [];

  if (isAccountSecurityEvent(args.eventContext.primaryEventType)) {
    flags.push("account_access");
  }
  if (isCommerceEvent(args.eventContext.primaryEventType)) {
    flags.push("financial_or_purchase");
  }
  if (isWorkflowEvent(args.eventContext.primaryEventType)) {
    flags.push("workflow_relevant");
  }
  if (args.eventContext.primaryEventType === "phishing_or_impersonation") {
    flags.push("impersonation_risk");
  }
  if (
    args.securitySeverity === "suspicious" ||
    args.securitySeverity === "harmful" ||
    args.securitySeverity === "critical"
  ) {
    flags.push("security_sensitive");
  }
  if (args.extracted.deadlines.length > 0) {
    flags.push("deadline_present");
  }
  if (args.extracted.attachmentRiskScore >= 30) {
    flags.push("risky_attachment");
  }
  if (args.actionRoute === "quarantine" || args.actionRoute === "block") {
    flags.push("contained_threat");
  }
  if (
    args.eventContext.sensitiveEvent.detected &&
    args.eventContext.sensitiveEvent.mustNotMissScore >= 80
  ) {
    flags.push("must_not_miss");
  }
  if (args.eventContext.sensitiveEvent.timeSensitivity === "expires_soon") {
    flags.push("expires_soon");
  }
  if ((args.temporalFlags ?? []).includes("temporal:unresolved_thread")) {
    flags.push("temporal_followup");
  }
  if ((args.temporalFlags ?? []).includes("temporal:silence_break")) {
    flags.push("temporal_silence_break");
  }
  if (
    (args.temporalFlags ?? []).some((flag) => flag.startsWith("temporal:converging:"))
  ) {
    flags.push("temporal_convergence");
  }
  if (args.falsePositiveGuard?.guardActivated) {
    flags.push("false_positive_guard");
  }
  if ((args.guardrailHits ?? []).includes("learning_transactional_protection")) {
    flags.push("transactional_protection");
  }
  if ((args.guardrailHits ?? []).includes("learning_promo_fatigue")) {
    flags.push("promo_fatigue");
  }
  if (
    args.urgencyPrediction?.predictionFactors.some(
      (factor) =>
        factor.factor === "P3_conversation_gap" ||
        factor.factor === "P4_subject_trajectory"
    )
  ) {
    flags.push("pattern_novelty");
  }
  if (confidence.label === "low") {
    flags.push("low_confidence");
  }

  return uniqueStrings(flags).slice(0, 8);
}

/**
 * Chooses the safest next step using routing, event type, and severity rather than message prose.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: gives the user a conservative, decision-oriented action instead of paraphrasing the email content.
 */
function buildSafeNextStep(args: BuildDecisionCapsuleArgs): string {
  if (args.actionRoute === "block" || args.actionRoute === "quarantine") {
    return "No action advised. Let Aegis contain it.";
  }
  switch (args.eventContext.primaryEventType) {
    case "auth_otp":
    case "login_code":
      return "Use only if you are signing in now.";
    case "login_alert":
    case "new_device_signin":
    case "security_warning":
      return "Review account activity and secure the account if the activity was unexpected.";
    case "password_reset":
    case "password_changed":
    case "account_recovery":
      return "Review only if you initiated it; otherwise secure the account.";
    case "purchase_confirmed":
    case "order_shipped":
    case "receipt_invoice":
    case "refund_update":
      return "Review only if the account activity was unexpected.";
    case "billing_issue":
    case "payment_declined":
    case "subscription_created":
    case "subscription_renewal":
    case "new_membership":
      return "Review the account details if this was not expected.";
    case "job_application_update":
    case "interview_update":
    case "interview_scheduled":
    case "recruiter_reply":
      return "Open and review the update.";
    case "deadline_action_required":
    case "legal_notice":
    case "calendar_or_schedule":
      return "Review and decide the next step soon.";
    case "newsletter":
    case "promotional_commerce":
    case "bulk_marketing":
      return "No action needed unless you want the offer or update.";
    case "phishing_or_impersonation":
      return "Do not reply or click. Review only through a trusted account path.";
    case "community_or_forum":
      return "Review only if the conversation matters to you.";
    default:
      return args.actionRoute === "surface"
        ? "Review manually if it looks relevant."
        : "No immediate action needed.";
  }
}

/**
 * Produces the final analyst-style rationale for why the capsule landed where it did.
 *
 * Pipeline step: final decision capsule assembly.
 * False-positive scenario addressed: keeps the explanation decision-oriented and grounded in structured signals rather than paraphrasing email content.
 */
function buildShortRationale(
  args: BuildDecisionCapsuleArgs,
  userActionNeeded: DecisionCapsule["userActionNeeded"],
  confidence: CapsuleConfidence
): string {
  const clauses: string[] = [];

  if (args.actionRoute === "quarantine" || args.actionRoute === "block") {
    clauses.push("Aegis already contained the threat.");
  } else if (args.eventContext.primaryEventType === "phishing_or_impersonation") {
    clauses.push("Threat signals point to impersonation or phishing behavior.");
  } else if (isAccountSecurityEvent(args.eventContext.primaryEventType)) {
    clauses.push("This looks like an account-access event.");
  } else if (isCommerceEvent(args.eventContext.primaryEventType)) {
    clauses.push("This looks like a transactional account or commerce update.");
  } else if (isWorkflowEvent(args.eventContext.primaryEventType)) {
    clauses.push("This looks relevant to an active personal or work workflow.");
  } else if (
    args.eventContext.primaryEventType === "newsletter" ||
    args.eventContext.primaryEventType === "promotional_commerce" ||
    args.eventContext.primaryEventType === "bulk_marketing"
  ) {
    clauses.push("This looks like routine promotional or bulk traffic.");
  } else {
    clauses.push("The message has a recognizable event pattern, but the relevance is moderate.");
  }

  if (userActionNeeded === "yes") {
    clauses.push("The user should review it.");
  } else if (userActionNeeded === "maybe") {
    clauses.push("The user may need to act depending on whether the activity was expected.");
  } else {
    clauses.push("No direct user action is likely needed.");
  }

  if (
    args.securitySeverity === "harmful" ||
    args.securitySeverity === "critical"
  ) {
    clauses.push("Aegis is treating the security angle as harmful.");
  } else if (args.securitySeverity === "suspicious") {
    clauses.push("There is a meaningful security or sensitivity angle.");
  }

  if ((args.temporalFlags ?? []).includes("temporal:unresolved_thread")) {
    clauses.push("Temporal context suggests this is part of an unresolved thread.");
  } else if (args.temporalContext?.dominantTemporalSignal === "converging_signal") {
    clauses.push("Batch context found a coordinated pattern across multiple emails.");
  } else if (args.temporalContext?.dominantTemporalSignal === "silence_break") {
    clauses.push("Sender timing broke its normal pattern.");
  }

  const noveltyFactor = args.urgencyPrediction?.predictionFactors.find(
    (factor) =>
      factor.factor === "P3_conversation_gap" ||
      factor.factor === "P4_subject_trajectory"
  );
  if (noveltyFactor?.direction === "boost") {
    clauses.push("Batch timing or pattern novelty raised urgency.");
  } else if (noveltyFactor?.direction === "suppress") {
    clauses.push("Repeated batch patterns reduced urgency inflation.");
  }

  if ((args.guardrailHits ?? []).includes("learning_transactional_protection")) {
    clauses.push("Transactional protection kept it from being buried as promo noise.");
  } else if (args.falsePositiveGuard?.guardActivated) {
    clauses.push("False-positive guardrails adjusted the final decision.");
  }

  if (confidence.label === "low" && confidence.note) {
    clauses.push("Signal confidence is limited.");
  }

  return clauses.join(" ");
}

/**
 * Builds the Aegis-native decision capsule for one email after routing is known.
 *
 * Pipeline step: final response assembly after attention, severity, and action route have all been derived.
 * False-positive scenario addressed: replaces generic inbox-style summaries with a deterministic, decision-oriented capsule that tells the user whether to care and how to respond safely.
 */
export function buildDecisionCapsule(args: BuildDecisionCapsuleArgs): DecisionCapsule {
  const confidence = buildCapsuleConfidence(args);
  const confidenceNotes = buildConfidenceNotes(args, confidence);
  const userActionNeeded = buildUserActionNeeded(args);
  const expiresOrDeadline = buildExpiresOrDeadline(args);
  const sensitivityFlags = buildSensitivityFlags(args, confidence);
  const safeNextStep = buildSafeNextStep(args);
  const shortRationale = buildShortRationale(args, userActionNeeded, confidence);

  return DecisionCapsuleSchema.parse({
    headline: buildHeadline(args),
    primaryEventType: args.eventContext.primaryEventType,
    eventType: args.eventContext.primaryEventType,
    attentionPriority: args.attentionPriority,
    securitySeverity: args.securitySeverity,
    actionRoute: args.actionRoute,
    userActionNeeded,
    expiresOrDeadline,
    sensitivityFlags,
    safeNextStep,
    shortRationale,
    confidenceNotes,
    confidenceLabel: confidence.label,
    confidenceNote: confidenceNotes[0] ?? confidence.note,
  });
}
