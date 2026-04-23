import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEventDecisionAdjustments,
  applySensitiveEventBoosts,
  inferInboxEvent,
  type InboxEventType,
} from "./eventTaxonomy";

function inferExample(args: {
  subject: string;
  body: string;
  senderEmail?: string;
  senderDomain?: string;
  deadlines?: string[];
  moneyMentions?: string[];
  urls?: string[];
  attachments?: string[];
  attachmentRiskScore?: number;
  primaryCategory: string;
  riskTags?: string[];
  trustScore?: number;
  reputationScore?: number;
  lowRiskPromotional?: boolean;
  promotionalConfidence?: number;
  promoUrgencyHits?: number;
  senderPromoHints?: number;
  threatScore?: number;
  urgencyScore?: number;
  relevanceScore?: number;
  opportunityScore?: number;
  noiseScore?: number;
  trustGapScore?: number;
  affinityScore?: number;
  attentionType?: "act_now" | "verify_now" | "review_later" | "ignore_routine";
}) {
  return inferInboxEvent({
    email: {
      subject: args.subject,
      body: args.body,
      senderEmail: args.senderEmail ?? "sender@example.com",
      senderDomain: args.senderDomain ?? "example.com",
      extracted: {
        deadlines: args.deadlines ?? [],
        moneyMentions: args.moneyMentions ?? [],
        urls: args.urls ?? [],
        attachments: args.attachments ?? [],
        attachmentRiskScore: args.attachmentRiskScore ?? 0,
      },
    },
    scoring: {
      primaryCategory: args.primaryCategory,
      riskTags: args.riskTags ?? [],
      trustScore: args.trustScore ?? 60,
      reputationScore: args.reputationScore ?? 70,
      promotional: {
        lowRiskPromotional: args.lowRiskPromotional ?? false,
        promotionalConfidence: args.promotionalConfidence ?? 0,
        promoUrgencyHits: args.promoUrgencyHits ?? 0,
        senderPromoHints: args.senderPromoHints ?? 0,
      },
      decisionImportance: {
        threatScore: args.threatScore ?? 18,
        urgencyScore: args.urgencyScore ?? 24,
        relevanceScore: args.relevanceScore ?? 30,
        opportunityScore: args.opportunityScore ?? 0,
        noiseScore: args.noiseScore ?? 12,
        trustGapScore: args.trustGapScore ?? 16,
        affinityScore: args.affinityScore ?? 18,
        attentionType: args.attentionType ?? "review_later",
        rationale: "test rationale",
      },
    },
  });
}

function expectPrimary(
  actual: ReturnType<typeof inferExample>,
  expected: InboxEventType
): void {
  assert.equal(actual.primaryEventType, expected);
  assert.ok(actual.confidence >= 30);
}

test("phishing invoice lure maps to phishing_or_impersonation with commerce context as secondary", () => {
  const event = inferExample({
    subject: "Urgent invoice payment needed today",
    body: "Please process the wire transfer immediately and send the beneficiary details back to me.",
    primaryCategory: "scam_invoice_fraud",
    riskTags: ["Invoice Scam", "Credential Phishing"],
    moneyMentions: ["$12,840"],
    threatScore: 92,
    urgencyScore: 54,
    trustScore: 18,
    reputationScore: 28,
    attentionType: "verify_now",
  });

  expectPrimary(event, "phishing_or_impersonation");
  assert.ok(
    event.secondaryTags.includes("receipt_invoice") ||
      event.secondaryTags.includes("deadline_action_required")
  );
});

test("OTP email maps to login_code with auth_otp tagging", () => {
  const event = inferExample({
    subject: "Your login code",
    body: "Use verification code 442981 to complete sign-in.",
    primaryCategory: "security_phishing",
    threatScore: 24,
    urgencyScore: 70,
    relevanceScore: 82,
    attentionType: "act_now",
  });

  expectPrimary(event, "login_code");
  assert.ok(event.secondaryTags.includes("auth_otp"));
});

test("purchase confirmation maps to transactional commerce rather than promo", () => {
  const event = inferExample({
    subject: "Order confirmed",
    body: "Thanks for your order. Your receipt is ready and your package will ship soon.",
    primaryCategory: "general",
    trustScore: 78,
    reputationScore: 82,
    threatScore: 10,
  });

  expectPrimary(event, "purchase_confirmed");
  assert.ok(event.secondaryTags.includes("receipt_invoice"));
  assert.ok(!event.secondaryTags.includes("promotional_commerce"));
});

test("Temu-style sale email maps to promotional_commerce or bulk_marketing, not harmful by default", () => {
  const event = inferExample({
    subject: "Temu flash sale ends tonight",
    body: "Limited time deal, coupon inside, shop now for up to 80% off.",
    primaryCategory: "sales_marketing",
    lowRiskPromotional: true,
    promotionalConfidence: 3.6,
    promoUrgencyHits: 2,
    senderPromoHints: 3,
    threatScore: 8,
    noiseScore: 80,
    attentionType: "ignore_routine",
  });

  assert.ok(
    event.primaryEventType === "promotional_commerce" ||
      event.primaryEventType === "bulk_marketing"
  );
  assert.notEqual(event.primaryEventType, "phishing_or_impersonation");
});

test("suspicious login alert maps to login_alert with security_warning or new_device_signin tags", () => {
  const event = inferExample({
    subject: "Security alert: suspicious sign-in detected",
    body: "We noticed a new sign-in attempt from a device we do not recognize. Review your account now.",
    primaryCategory: "security_phishing",
    threatScore: 38,
    urgencyScore: 74,
    attentionType: "act_now",
  });

  expectPrimary(event, "login_alert");
  assert.ok(
    event.secondaryTags.includes("new_device_signin") ||
      event.secondaryTags.includes("security_warning")
  );
});

test("job application status update maps to interview_scheduled with job context", () => {
  const event = inferExample({
    subject: "Application status update",
    body: "The hiring team has updated your application status and invited you to schedule an interview.",
    primaryCategory: "general",
    threatScore: 8,
    relevanceScore: 84,
  });

  expectPrimary(event, "interview_scheduled");
  assert.ok(
    event.secondaryTags.includes("job_application_update") ||
      event.secondaryTags.includes("recruiter_reply")
  );
});

test("trusted invoice stays receipt_invoice when threat signals are low", () => {
  const event = inferExample({
    subject: "Invoice paid",
    body: "Your payment receipt is attached to your account portal.",
    primaryCategory: "finance_payment",
    moneyMentions: ["$89.00"],
    trustScore: 84,
    reputationScore: 88,
    threatScore: 18,
    riskTags: ["Payment"],
  });

  expectPrimary(event, "receipt_invoice");
  assert.ok(!event.secondaryTags.includes("phishing_or_impersonation"));
});

test("event adjustments raise relevance for safe high-value mail and suppress promo noise", () => {
  const purchaseEvent = inferExample({
    subject: "Order confirmed",
    body: "Thanks for your order. Your receipt is ready.",
    primaryCategory: "general",
    threatScore: 12,
  });
  const adjustedPurchase = applyEventDecisionAdjustments(
    {
      threatScore: 12,
      urgencyScore: 42,
      relevanceScore: 40,
      opportunityScore: 0,
      noiseScore: 18,
      trustGapScore: 8,
      affinityScore: 14,
      attentionType: "review_later",
      rationale: "base",
    },
    purchaseEvent
  );
  assert.ok(adjustedPurchase.relevanceScore > 40);
  assert.ok(adjustedPurchase.noiseScore < 18);

  const promoEvent = inferExample({
    subject: "Flash sale",
    body: "Coupon inside. Shop now for a limited time deal.",
    primaryCategory: "sales_marketing",
    lowRiskPromotional: true,
    promotionalConfidence: 2.9,
  });
  const adjustedPromo = applyEventDecisionAdjustments(
    {
      threatScore: 6,
      urgencyScore: 12,
      relevanceScore: 18,
      opportunityScore: 8,
      noiseScore: 52,
      trustGapScore: 10,
      affinityScore: 10,
      attentionType: "ignore_routine",
      rationale: "base",
    },
    promoEvent
  );
  assert.ok(adjustedPromo.noiseScore >= 52);
});

test("OTP still wins in a promo-heavy mailbox and triggers a sensitive auth-flow boost", () => {
  const event = inferExample({
    subject: "Use this login code before our spring sale ends",
    body: "Your sign-in code is 551204. Save 20% after you log in.",
    primaryCategory: "sales_marketing",
    lowRiskPromotional: true,
    promotionalConfidence: 3.2,
    promoUrgencyHits: 1,
    senderPromoHints: 2,
    threatScore: 18,
    urgencyScore: 62,
    attentionType: "act_now",
  });

  expectPrimary(event, "login_code");
  assert.equal(event.sensitiveEvent.detected, true);
  assert.equal(event.sensitiveEvent.family, "auth_flow");
  assert.ok(event.sensitiveEvent.attentionBoost >= 20);
});

test("purchase confirmation from a trusted sender triggers commerce sensitivity without promo collision", () => {
  const event = inferExample({
    subject: "Your order has been confirmed",
    body: "Thanks for your order. Your receipt is available in your account.",
    senderDomain: "amazon.com",
    primaryCategory: "general",
    trustScore: 84,
    reputationScore: 88,
    threatScore: 10,
  });

  expectPrimary(event, "purchase_confirmed");
  assert.equal(event.sensitiveEvent.detected, true);
  assert.equal(event.sensitiveEvent.family, "commerce_transaction");
  assert.equal(event.sensitiveEvent.securityBoost, 0);
});

test("security alert from a known provider raises both sensitive attention and security lift", () => {
  const event = inferExample({
    subject: "Security alert: new sign-in on your Google Account",
    body: "We noticed a new sign-in attempt from a device we do not recognize.",
    senderDomain: "google.com",
    primaryCategory: "security_phishing",
    trustScore: 86,
    reputationScore: 90,
    threatScore: 34,
    attentionType: "act_now",
  });

  expectPrimary(event, "login_alert");
  assert.equal(event.sensitiveEvent.detected, true);
  assert.equal(event.sensitiveEvent.family, "account_security");
  assert.ok(event.sensitiveEvent.securityBoost >= 10);
});

test("recruiter reply without explicit recruiter keyword can still be inferred from sender and workflow cues", () => {
  const event = inferExample({
    subject: "Next steps for the role",
    body: "Thank you for your time. We'd love to continue the conversation and coordinate availability.",
    senderEmail: "talent@greenhouse.io",
    senderDomain: "greenhouse.io",
    primaryCategory: "general",
    threatScore: 8,
    relevanceScore: 72,
  });

  assert.ok(
    event.primaryEventType === "recruiter_reply" ||
      event.primaryEventType === "interview_scheduled" ||
      event.primaryEventType === "job_application_update"
  );
  assert.equal(event.sensitiveEvent.detected, true);
  assert.equal(event.sensitiveEvent.family, "career_workflow");
});

test("new membership email becomes a sensitive lifecycle event", () => {
  const event = inferExample({
    subject: "Welcome, your trial started",
    body: "Your membership has been created and your plan is now active.",
    primaryCategory: "general",
    threatScore: 6,
    relevanceScore: 58,
  });

  expectPrimary(event, "new_membership");
  assert.equal(event.sensitiveEvent.detected, true);
  assert.equal(event.sensitiveEvent.family, "membership_lifecycle");
});

test("sensitive-event boosts raise urgency and threat only where appropriate", () => {
  const loginAlert = inferExample({
    subject: "Security alert",
    body: "New sign-in attempt from a device we do not recognize.",
    primaryCategory: "security_phishing",
    threatScore: 30,
  });

  const adjusted = applySensitiveEventBoosts(
    {
      threatScore: 30,
      urgencyScore: 48,
      relevanceScore: 56,
      opportunityScore: 0,
      noiseScore: 18,
      trustGapScore: 22,
      affinityScore: 10,
      attentionType: "act_now",
      rationale: "base",
    },
    loginAlert
  );

  assert.ok(adjusted.urgencyScore > 48);
  assert.ok(adjusted.relevanceScore > 56);
  assert.ok(adjusted.threatScore > 30);
  assert.ok(adjusted.noiseScore < 18);
});
