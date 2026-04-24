import assert from "node:assert/strict";
import test from "node:test";

import { buildDecisionCapsule } from "./decisionCapsule";
import type { InboxEventType } from "./eventTaxonomy";

function buildExample(args: {
  eventType: InboxEventType;
  secondaryTags?: InboxEventType[];
  eventConfidence?: number;
  attentionPriority: "none" | "low" | "medium" | "high" | "urgent";
  securitySeverity: "benign" | "noisy" | "suspicious" | "harmful" | "critical";
  actionRoute: "suppress" | "surface" | "escalate" | "quarantine" | "block";
  sensitiveEvent?: {
    detected: boolean;
    family:
      | "auth_flow"
      | "account_security"
      | "account_recovery"
      | "commerce_transaction"
      | "membership_lifecycle"
      | "billing_lifecycle"
      | "career_workflow"
      | null;
    confidence: number;
    attentionBoost: number;
    securityBoost: number;
    mustNotMissScore: number;
    timeSensitivity: "low" | "medium" | "high" | "expires_soon";
    routeHint: "surface" | "escalate" | null;
    rationale: string;
    guardrails: string[];
  };
  uncertaintyScore?: number;
  temporalFlags?: string[];
  guardrailHits?: string[];
  falsePositiveGuard?: {
    guardActivated: boolean;
    correctionRules: string[];
    correctionReasons: string[];
  };
  temporalContext?: {
    dominantTemporalSignal: "silence_break" | "unresolved_thread" | "converging_signal" | null;
    explanationNotes: string[];
    routingOverride: "escalate" | "human_review" | null;
    totalUrgencyDelta: number;
    totalThreatDelta: number;
  };
  urgencyPrediction?: {
    temporalContext: "operational_window" | "close_window" | "async_context" | "standard";
    predictionConfidence: number;
    predictionFactors: Array<{
      factor: string;
      direction: "boost" | "suppress";
      magnitude: number;
      rationale: string;
    }>;
    urgencyDelta: number;
  };
  deadlines?: string[];
  moneyMentions?: string[];
  urls?: string[];
  attachments?: string[];
  attachmentRiskScore?: number;
}) {
  return buildDecisionCapsule({
    eventContext: {
      primaryEventType: args.eventType,
      secondaryTags: args.secondaryTags ?? [],
      confidence: args.eventConfidence ?? 90,
      sensitiveEvent: args.sensitiveEvent ?? {
        detected: false,
        family: null,
        confidence: 0,
        attentionBoost: 0,
        securityBoost: 0,
        mustNotMissScore: 0,
        timeSensitivity: "low",
        routeHint: null,
        rationale: "test default",
        guardrails: [],
      },
    },
    attentionPriority: args.attentionPriority,
    securitySeverity: args.securitySeverity,
    actionRoute: args.actionRoute,
    uncertainty: {
      score: args.uncertaintyScore ?? 0.18,
    },
    temporalFlags: args.temporalFlags ?? [],
    guardrailHits: args.guardrailHits ?? [],
    falsePositiveGuard:
      args.falsePositiveGuard ?? {
        guardActivated: false,
        correctionRules: [],
        correctionReasons: [],
      },
    temporalContext:
      args.temporalContext ?? {
        dominantTemporalSignal: null,
        explanationNotes: [],
        routingOverride: null,
        totalUrgencyDelta: 0,
        totalThreatDelta: 0,
      },
    urgencyPrediction:
      args.urgencyPrediction ?? {
        temporalContext: "standard",
        predictionConfidence: 0,
        predictionFactors: [],
        urgencyDelta: 0,
      },
    extracted: {
      deadlines: args.deadlines ?? [],
      moneyMentions: args.moneyMentions ?? [],
      urls: args.urls ?? [],
      attachments: args.attachments ?? [],
      attachmentRiskScore: args.attachmentRiskScore ?? 0,
    },
  });
}

test("OTP capsule is short, decision-oriented, and time-sensitive", () => {
  const capsule = buildExample({
    eventType: "login_code",
    secondaryTags: ["auth_otp"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
    sensitiveEvent: {
      detected: true,
      family: "auth_flow",
      confidence: 96,
      attentionBoost: 24,
      securityBoost: 0,
      mustNotMissScore: 96,
      timeSensitivity: "expires_soon",
      routeHint: "surface",
      rationale: "test auth flow",
      guardrails: [],
    },
  });

  assert.equal(capsule.headline, "Login code for your account");
  assert.equal(capsule.primaryEventType, "login_code");
  assert.equal(capsule.actionRoute, "surface");
  assert.equal(capsule.userActionNeeded, "maybe");
  assert.equal(capsule.expiresOrDeadline, "Expires soon");
  assert.equal(capsule.safeNextStep, "Use only if you are signing in now.");
});

test("purchase confirmation capsule tells the user to review only if unexpected", () => {
  const capsule = buildExample({
    eventType: "purchase_confirmed",
    secondaryTags: ["receipt_invoice"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
  });

  assert.equal(capsule.headline, "Purchase confirmed on your account");
  assert.equal(capsule.primaryEventType, "purchase_confirmed");
  assert.equal(capsule.actionRoute, "surface");
  assert.equal(capsule.userActionNeeded, "maybe");
  assert.equal(capsule.safeNextStep, "Review only if the account activity was unexpected.");
  assert.ok(capsule.sensitivityFlags.includes("financial_or_purchase"));
});

test("login alert capsule highlights the account sensitivity", () => {
  const capsule = buildExample({
    eventType: "login_alert",
    secondaryTags: ["security_warning"],
    attentionPriority: "high",
    securitySeverity: "suspicious",
    actionRoute: "surface",
    sensitiveEvent: {
      detected: true,
      family: "account_security",
      confidence: 92,
      attentionBoost: 20,
      securityBoost: 12,
      mustNotMissScore: 90,
      timeSensitivity: "high",
      routeHint: "surface",
      rationale: "test account security",
      guardrails: [],
    },
    uncertaintyScore: 0.22,
  });

  assert.equal(capsule.headline, "Account login alert");
  assert.equal(capsule.primaryEventType, "login_alert");
  assert.equal(capsule.actionRoute, "surface");
  assert.equal(capsule.userActionNeeded, "maybe");
  assert.equal(
    capsule.safeNextStep,
    "Review account activity and secure the account if the activity was unexpected."
  );
  assert.ok(capsule.sensitivityFlags.includes("account_access"));
  assert.ok(capsule.sensitivityFlags.includes("security_sensitive"));
});

test("job update capsule says the user should review it", () => {
  const capsule = buildExample({
    eventType: "job_application_update",
    secondaryTags: ["interview_update"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
  });

  assert.equal(capsule.headline, "Job application update");
  assert.equal(capsule.primaryEventType, "job_application_update");
  assert.equal(capsule.actionRoute, "surface");
  assert.equal(capsule.userActionNeeded, "yes");
  assert.equal(capsule.safeNextStep, "Open and review the update.");
  assert.ok(capsule.shortRationale.includes("should review"));
});

test("payment declined capsule keeps the message user-relevant without calling it harmful", () => {
  const capsule = buildExample({
    eventType: "payment_declined",
    secondaryTags: ["billing_issue"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
  });

  assert.equal(capsule.headline, "Payment declined on your account");
  assert.equal(capsule.userActionNeeded, "maybe");
  assert.equal(capsule.safeNextStep, "Review the account details if this was not expected.");
  assert.ok(capsule.sensitivityFlags.includes("financial_or_purchase"));
});

test("promotional sale capsule is low-attention and suppressible", () => {
  const capsule = buildExample({
    eventType: "promotional_commerce",
    secondaryTags: ["bulk_marketing"],
    attentionPriority: "low",
    securitySeverity: "noisy",
    actionRoute: "suppress",
  });

  assert.equal(capsule.headline, "Promotional commerce mail");
  assert.equal(capsule.primaryEventType, "promotional_commerce");
  assert.equal(capsule.actionRoute, "suppress");
  assert.equal(capsule.userActionNeeded, "no");
  assert.equal(capsule.expiresOrDeadline, null);
  assert.equal(capsule.safeNextStep, "No action needed unless you want the offer or update.");
});

test("low-confidence capsule exposes uncertainty in structured form", () => {
  const capsule = buildExample({
    eventType: "general_update",
    attentionPriority: "medium",
    securitySeverity: "benign",
    actionRoute: "surface",
    eventConfidence: 34,
    uncertaintyScore: 0.68,
  });

  assert.equal(capsule.confidenceLabel, "low");
  assert.ok(capsule.confidenceNote);
  assert.ok(capsule.confidenceNotes.length >= 1);
  assert.ok(capsule.sensitivityFlags.includes("low_confidence"));
});

test("contained harmful mail produces a no-action decision capsule", () => {
  const capsule = buildExample({
    eventType: "phishing_or_impersonation",
    attentionPriority: "low",
    securitySeverity: "critical",
    actionRoute: "quarantine",
  });

  assert.equal(capsule.headline, "Dangerous message already quarantined");
  assert.equal(capsule.userActionNeeded, "no");
  assert.equal(capsule.safeNextStep, "No action advised. Let Aegis contain it.");
  assert.ok(capsule.sensitivityFlags.includes("contained_threat"));
});

test("temporal and guardrail context appear in the capsule notes when available", () => {
  const capsule = buildExample({
    eventType: "purchase_confirmed",
    secondaryTags: ["receipt_invoice"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
    temporalFlags: ["temporal:unresolved_thread", "temporal:routing:human_review"],
    guardrailHits: ["learning_transactional_protection"],
    falsePositiveGuard: {
      guardActivated: true,
      correctionRules: ["fp_guard_balance"],
      correctionReasons: ["reduced overreaction risk"],
    },
    temporalContext: {
      dominantTemporalSignal: "unresolved_thread",
      explanationNotes: [
        "Follow-up to unresolved thread 1.5h after the last actionable item.",
      ],
      routingOverride: "human_review",
      totalUrgencyDelta: 16,
      totalThreatDelta: 0,
    },
    urgencyPrediction: {
      temporalContext: "standard",
      predictionConfidence: 82,
      predictionFactors: [
        {
          factor: "P4_subject_trajectory",
          direction: "boost",
          magnitude: 7,
          rationale:
            "Novel hashed subject pattern within the current batch suggests a meaningful change from this sender.",
        },
      ],
      urgencyDelta: 7,
    },
  });

  assert.ok(capsule.sensitivityFlags.includes("temporal_followup"));
  assert.ok(capsule.sensitivityFlags.includes("false_positive_guard"));
  assert.ok(capsule.sensitivityFlags.includes("transactional_protection"));
  assert.ok(capsule.sensitivityFlags.includes("pattern_novelty"));
  assert.ok(capsule.confidenceNotes.some((note) => note.includes("Temporal context")));
  assert.ok(capsule.confidenceNotes.some((note) => note.includes("False-positive guard")));
  assert.ok(capsule.confidenceNotes.some((note) => note.includes("Novel hashed subject pattern")));
  assert.ok(capsule.shortRationale.includes("unresolved thread"));
});
