import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDecisionAxes,
  buildDecisionAxesFeedbackLabel,
} from "./decisionAxes";
import type { InboxEventType } from "./eventTaxonomy";
import type { InboxMailClass, InboxThreatType } from "./schemas";

function buildExample(args: {
  primaryCategory: string;
  priorityScore: number;
  priorityBand: "high" | "medium" | "low";
  mailClass: InboxMailClass;
  threatType: InboxThreatType;
  trustedAction: "allow" | "escalate" | "quarantine" | "block";
  finalAction: "auto_triage" | "escalate" | "human_review";
  riskLevel: "low" | "medium" | "high";
  subject: string;
  bodyPreview: string;
  threatScore: number;
  urgencyScore: number;
  relevanceScore: number;
  opportunityScore: number;
  noiseScore: number;
  trustGapScore: number;
  attentionType: "act_now" | "verify_now" | "review_later" | "ignore_routine";
  harmfulProbability: number;
  actionableProbability?: number;
  informationalProbability?: number;
  spamProbability?: number;
  attachmentRiskScore?: number;
  urls?: string[];
  deadlines?: string[];
  riskTags?: string[];
  temporalFlags?: string[];
  eventType?: InboxEventType;
  secondaryEventTags?: InboxEventType[];
}) {
  return buildDecisionAxes({
    primaryCategory: args.primaryCategory,
    priorityScore: args.priorityScore,
    priorityBand: args.priorityBand,
    mailClass: args.mailClass,
    decisionImportance: {
      threatScore: args.threatScore,
      urgencyScore: args.urgencyScore,
      relevanceScore: args.relevanceScore,
      opportunityScore: args.opportunityScore,
      noiseScore: args.noiseScore,
      trustGapScore: args.trustGapScore,
      affinityScore: 18,
      attentionType: args.attentionType,
      rationale: "test rationale",
    },
    trustedDecision: {
      action: args.trustedAction,
      riskScore:
        args.riskLevel === "high" ? 82 : args.riskLevel === "medium" ? 56 : 24,
    },
    decision: {
      final_action: args.finalAction,
      reason: "test route reason",
      risk_level: args.riskLevel,
    },
    threatType: args.threatType,
    classifier: {
      probabilities: {
        harmful: args.harmfulProbability,
        actionable: args.actionableProbability ?? 0.2,
        informational: args.informationalProbability ?? 0.2,
        spam: args.spamProbability ?? 0.1,
      },
    },
    extracted: {
      attachmentRiskScore: args.attachmentRiskScore ?? 0,
      urls: args.urls ?? [],
      deadlines: args.deadlines ?? [],
    },
    riskTags: args.riskTags ?? [],
    subject: args.subject,
    bodyPreview: args.bodyPreview,
    temporalFlags: args.temporalFlags ?? [],
    eventContext: args.eventType
      ? {
          primaryEventType: args.eventType,
          secondaryTags: args.secondaryEventTags ?? [],
          confidence: 92,
          sensitiveEvent: {
            detected: false,
            family: null,
            confidence: 0,
            attentionBoost: 0,
            securityBoost: 0,
            routeHint: null,
            rationale: "test default",
            guardrails: [],
          },
        }
      : undefined,
  });
}

test("phishing invoice lure is harmful but low attention and routed to quarantine", () => {
  const axes = buildExample({
    primaryCategory: "scam_invoice_fraud",
    priorityScore: 78,
    priorityBand: "medium",
    mailClass: "harmful",
    threatType: "payment_fraud",
    trustedAction: "quarantine",
    finalAction: "human_review",
    riskLevel: "high",
    subject: "Urgent invoice payment needed today",
    bodyPreview:
      "Please process the wire transfer immediately and use the attached beneficiary details.",
    threatScore: 92,
    urgencyScore: 48,
    relevanceScore: 22,
    opportunityScore: 0,
    noiseScore: 4,
    trustGapScore: 88,
    attentionType: "verify_now",
    harmfulProbability: 0.94,
    attachmentRiskScore: 34,
    urls: ["https://malicious.example/pay"],
    riskTags: ["Invoice Scam", "Credential Phishing"],
    eventType: "phishing_or_impersonation",
    secondaryEventTags: ["receipt_invoice"],
  });

  assert.equal(axes.attentionPriority.level, "low");
  assert.ok(
    axes.securitySeverity.level === "harmful" ||
      axes.securitySeverity.level === "critical"
  );
  assert.equal(axes.actionRoute.route, "quarantine");
});

test("OTP email is high attention, benign severity, and surfaced", () => {
  const axes = buildExample({
    primaryCategory: "security_phishing",
    priorityScore: 64,
    priorityBand: "medium",
    mailClass: "actionable",
    threatType: "phishing",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "low",
    subject: "Your login code",
    bodyPreview: "Use verification code 442981 to complete sign-in.",
    threatScore: 30,
    urgencyScore: 68,
    relevanceScore: 82,
    opportunityScore: 0,
    noiseScore: 6,
    trustGapScore: 18,
    attentionType: "act_now",
    harmfulProbability: 0.16,
    actionableProbability: 0.74,
    informationalProbability: 0.08,
    urls: [],
    riskTags: ["Security"],
    eventType: "login_code",
    secondaryEventTags: ["auth_otp"],
  });

  assert.ok(
    axes.attentionPriority.level === "high" ||
      axes.attentionPriority.level === "urgent"
  );
  assert.equal(axes.securitySeverity.level, "benign");
  assert.equal(axes.actionRoute.route, "surface");
});

test("purchase confirmation is high attention, benign severity, and surfaced", () => {
  const axes = buildExample({
    primaryCategory: "general",
    priorityScore: 58,
    priorityBand: "medium",
    mailClass: "informational",
    threatType: "none",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "low",
    subject: "Order confirmed",
    bodyPreview:
      "Thanks for your purchase. Your order has been confirmed and your receipt is attached in your account portal.",
    threatScore: 12,
    urgencyScore: 44,
    relevanceScore: 70,
    opportunityScore: 0,
    noiseScore: 8,
    trustGapScore: 10,
    attentionType: "review_later",
    harmfulProbability: 0.04,
    actionableProbability: 0.28,
    informationalProbability: 0.68,
    eventType: "purchase_confirmed",
    secondaryEventTags: ["receipt_invoice"],
  });

  assert.equal(axes.attentionPriority.level, "high");
  assert.equal(axes.securitySeverity.level, "benign");
  assert.equal(axes.actionRoute.route, "surface");
});

test("Temu promotional sale email is low attention, noisy severity, and suppressed", () => {
  const axes = buildExample({
    primaryCategory: "sales_marketing",
    priorityScore: 22,
    priorityBand: "low",
    mailClass: "spam",
    threatType: "none",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "low",
    subject: "Temu flash sale ends tonight",
    bodyPreview:
      "Limited time deal, coupon inside, shop now for up to 80% off.",
    threatScore: 8,
    urgencyScore: 12,
    relevanceScore: 10,
    opportunityScore: 8,
    noiseScore: 82,
    trustGapScore: 12,
    attentionType: "ignore_routine",
    harmfulProbability: 0.05,
    actionableProbability: 0.05,
    informationalProbability: 0.2,
    spamProbability: 0.7,
    eventType: "promotional_commerce",
    secondaryEventTags: ["bulk_marketing"],
  });

  assert.ok(
    axes.attentionPriority.level === "none" ||
      axes.attentionPriority.level === "low"
  );
  assert.equal(axes.securitySeverity.level, "noisy");
  assert.equal(axes.actionRoute.route, "suppress");
});

test("suspicious login alert is high attention, suspicious severity, and surfaced", () => {
  const axes = buildExample({
    primaryCategory: "security_phishing",
    priorityScore: 62,
    priorityBand: "medium",
    mailClass: "actionable",
    threatType: "none",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "medium",
    subject: "Security alert: suspicious sign-in detected",
    bodyPreview:
      "We noticed a new sign-in attempt from a device we do not recognize. Review your account now.",
    threatScore: 38,
    urgencyScore: 72,
    relevanceScore: 76,
    opportunityScore: 0,
    noiseScore: 4,
    trustGapScore: 28,
    attentionType: "act_now",
    harmfulProbability: 0.32,
    actionableProbability: 0.56,
    informationalProbability: 0.12,
    eventType: "login_alert",
    secondaryEventTags: ["security_warning", "new_device_signin"],
  });

  assert.ok(
    axes.attentionPriority.level === "high" ||
      axes.attentionPriority.level === "urgent"
  );
  assert.equal(axes.securitySeverity.level, "suspicious");
  assert.equal(axes.actionRoute.route, "surface");
});

test("job application status update is high attention, benign severity, and surfaced", () => {
  const axes = buildExample({
    primaryCategory: "general",
    priorityScore: 61,
    priorityBand: "medium",
    mailClass: "actionable",
    threatType: "none",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "low",
    subject: "Application status update",
    bodyPreview:
      "The hiring team has updated your application status and invited you to schedule an interview.",
    threatScore: 10,
    urgencyScore: 54,
    relevanceScore: 84,
    opportunityScore: 0,
    noiseScore: 6,
    trustGapScore: 14,
    attentionType: "review_later",
    harmfulProbability: 0.03,
    actionableProbability: 0.72,
    informationalProbability: 0.25,
    eventType: "job_application_update",
    secondaryEventTags: ["interview_scheduled"],
  });

  assert.equal(axes.attentionPriority.level, "high");
  assert.equal(axes.securitySeverity.level, "benign");
  assert.equal(axes.actionRoute.route, "surface");
});

test("feedback label preserves the new three-axis model", () => {
  const axes = buildExample({
    primaryCategory: "sales_marketing",
    priorityScore: 18,
    priorityBand: "low",
    mailClass: "spam",
    threatType: "none",
    trustedAction: "allow",
    finalAction: "auto_triage",
    riskLevel: "low",
    subject: "Flash sale",
    bodyPreview: "Coupon inside. Shop now.",
    threatScore: 6,
    urgencyScore: 9,
    relevanceScore: 8,
    opportunityScore: 6,
    noiseScore: 80,
    trustGapScore: 8,
    attentionType: "ignore_routine",
    harmfulProbability: 0.04,
    spamProbability: 0.74,
    eventType: "bulk_marketing",
    secondaryEventTags: ["promotional_commerce"],
  });

  assert.equal(
    buildDecisionAxesFeedbackLabel(axes),
    "attention:low|security:noisy|route:suppress|trusted:allow"
  );
});

test("OTP stays high attention even in a promo-heavy mailbox", () => {
  const axes = buildDecisionAxes({
    primaryCategory: "sales_marketing",
    priorityScore: 26,
    priorityBand: "low",
    mailClass: "actionable",
    decisionImportance: {
      threatScore: 18,
      urgencyScore: 34,
      relevanceScore: 42,
      opportunityScore: 6,
      noiseScore: 60,
      trustGapScore: 12,
      affinityScore: 12,
      attentionType: "review_later",
      rationale: "test rationale",
    },
    trustedDecision: {
      action: "allow",
      riskScore: 22,
    },
    decision: {
      final_action: "auto_triage",
      reason: "test route reason",
      risk_level: "low",
    },
    threatType: "none",
    classifier: {
      probabilities: {
        harmful: 0.1,
        actionable: 0.68,
        informational: 0.18,
        spam: 0.22,
      },
    },
    extracted: {
      attachmentRiskScore: 0,
      urls: [],
      deadlines: [],
    },
    riskTags: ["Security"],
    subject: "Use this login code before our spring sale ends",
    bodyPreview: "Your sign-in code is 551204. Save 20% after you log in.",
    eventContext: {
      primaryEventType: "login_code",
      secondaryTags: ["auth_otp", "promotional_commerce"],
      confidence: 94,
      sensitiveEvent: {
        detected: true,
        family: "auth_flow",
        confidence: 96,
        attentionBoost: 24,
        securityBoost: 0,
        routeHint: "surface",
        rationale: "short-lived auth flow",
        guardrails: [],
      },
    },
  });

  assert.equal(axes.attentionPriority.level, "urgent");
  assert.equal(axes.securitySeverity.level, "benign");
  assert.equal(axes.actionRoute.route, "surface");
});

test("known-provider security alert is surfaced with suspicious severity", () => {
  const axes = buildDecisionAxes({
    primaryCategory: "security_phishing",
    priorityScore: 38,
    priorityBand: "low",
    mailClass: "actionable",
    decisionImportance: {
      threatScore: 34,
      urgencyScore: 52,
      relevanceScore: 64,
      opportunityScore: 0,
      noiseScore: 12,
      trustGapScore: 24,
      affinityScore: 18,
      attentionType: "act_now",
      rationale: "test rationale",
    },
    trustedDecision: {
      action: "allow",
      riskScore: 40,
    },
    decision: {
      final_action: "auto_triage",
      reason: "test route reason",
      risk_level: "medium",
    },
    threatType: "none",
    classifier: {
      probabilities: {
        harmful: 0.28,
        actionable: 0.56,
        informational: 0.12,
        spam: 0.04,
      },
    },
    extracted: {
      attachmentRiskScore: 0,
      urls: [],
      deadlines: [],
    },
    riskTags: ["Security"],
    subject: "Security alert: new sign-in detected",
    bodyPreview: "We noticed a new device sign-in on your account.",
    eventContext: {
      primaryEventType: "login_alert",
      secondaryTags: ["new_device_signin", "security_warning"],
      confidence: 90,
      sensitiveEvent: {
        detected: true,
        family: "account_security",
        confidence: 92,
        attentionBoost: 20,
        securityBoost: 12,
        routeHint: "surface",
        rationale: "account anomaly",
        guardrails: [],
      },
    },
  });

  assert.ok(
    axes.attentionPriority.level === "high" ||
      axes.attentionPriority.level === "urgent"
  );
  assert.equal(axes.securitySeverity.level, "suspicious");
  assert.equal(axes.actionRoute.route, "surface");
});

test("new membership email becomes high attention without being harmful", () => {
  const axes = buildDecisionAxes({
    primaryCategory: "general",
    priorityScore: 34,
    priorityBand: "low",
    mailClass: "informational",
    decisionImportance: {
      threatScore: 8,
      urgencyScore: 24,
      relevanceScore: 52,
      opportunityScore: 0,
      noiseScore: 16,
      trustGapScore: 10,
      affinityScore: 16,
      attentionType: "review_later",
      rationale: "test rationale",
    },
    trustedDecision: {
      action: "allow",
      riskScore: 20,
    },
    decision: {
      final_action: "auto_triage",
      reason: "test route reason",
      risk_level: "low",
    },
    threatType: "none",
    classifier: {
      probabilities: {
        harmful: 0.04,
        actionable: 0.42,
        informational: 0.46,
        spam: 0.08,
      },
    },
    extracted: {
      attachmentRiskScore: 0,
      urls: [],
      deadlines: [],
    },
    riskTags: [],
    subject: "Welcome, your trial started",
    bodyPreview: "Your membership has been created and your plan is now active.",
    eventContext: {
      primaryEventType: "new_membership",
      secondaryTags: ["subscription_renewal"],
      confidence: 86,
      sensitiveEvent: {
        detected: true,
        family: "membership_lifecycle",
        confidence: 86,
        attentionBoost: 16,
        securityBoost: 2,
        routeHint: "surface",
        rationale: "membership lifecycle",
        guardrails: [],
      },
    },
  });

  assert.equal(axes.attentionPriority.level, "high");
  assert.equal(axes.securitySeverity.level, "benign");
  assert.equal(axes.actionRoute.route, "surface");
});
