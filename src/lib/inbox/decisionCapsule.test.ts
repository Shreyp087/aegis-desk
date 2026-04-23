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
  uncertaintyScore?: number;
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
    },
    attentionPriority: args.attentionPriority,
    securitySeverity: args.securitySeverity,
    actionRoute: args.actionRoute,
    uncertainty: {
      score: args.uncertaintyScore ?? 0.18,
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
  });

  assert.equal(capsule.headline, "Login code for your account");
  assert.equal(capsule.userActionNeeded, "maybe");
  assert.equal(capsule.expiresOrDeadline, "Likely short-lived");
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
    uncertaintyScore: 0.22,
  });

  assert.equal(capsule.headline, "Account login alert");
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
    secondaryTags: ["interview_scheduled"],
    attentionPriority: "high",
    securitySeverity: "benign",
    actionRoute: "surface",
  });

  assert.equal(capsule.headline, "Job application update");
  assert.equal(capsule.userActionNeeded, "yes");
  assert.equal(capsule.safeNextStep, "Open and review the update.");
  assert.ok(capsule.shortRationale.includes("should review"));
});

test("promotional sale capsule is low-attention and suppressible", () => {
  const capsule = buildExample({
    eventType: "promotional_commerce",
    secondaryTags: ["bulk_marketing"],
    attentionPriority: "low",
    securitySeverity: "noisy",
    actionRoute: "suppress",
  });

  assert.equal(capsule.headline, "Promotional commerce email");
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
  assert.ok(capsule.sensitivityFlags.includes("low_confidence"));
});
