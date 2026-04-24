import assert from "node:assert/strict";
import test from "node:test";

import { buildExplanation, buildSignalGroups } from "./compatibility";
import type { InboxDecision } from "./decision";
import type { InboxDecisionAxes } from "./decisionAxes";
import type { InboxEventInference } from "./eventTaxonomy";

type BuildExplanationFixtureArgs = {
  primaryCategory: string;
  priorityScore: number;
  trustedDecisionAction: "allow" | "escalate" | "quarantine" | "block";
  trustedDecisionRisk: number;
  riskTags?: string[];
  signals?: string[];
  ruleHits?: string[];
  guardrailRationale?: string;
  memorySampleCount?: number;
  trustScore?: number;
  reputationScore?: number;
  attachmentRiskScore?: number;
  classifierProbabilities?: {
    spam: number;
    harmful: number;
    actionable: number;
    informational: number;
  };
  decisionImportance?: {
    threatScore: number;
    urgencyScore: number;
    relevanceScore: number;
    opportunityScore: number;
    noiseScore: number;
    trustGapScore: number;
    affinityScore: number;
    attentionType: "act_now" | "verify_now" | "review_later" | "ignore_routine";
    rationale: string;
  };
  decisionAxes: InboxDecisionAxes;
  decision: InboxDecision;
  eventContext?: Pick<
    InboxEventInference,
    "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
  >;
  falsePositiveGuard?: {
    guardActivated: boolean;
    corrections: Array<{
      rule: string;
      delta: number;
      reason: string;
    }>;
  };
  temporalContext?: {
    temporalFlags: string[];
    totalUrgencyDelta: number;
    totalThreatDelta: number;
    routingOverride: "escalate" | "human_review" | null;
    silenceBreak?: {
      detected: boolean;
      rationale: string;
    };
    unresolvedThread?: {
      detected: boolean;
      rationale: string;
    };
    convergingSignal?: {
      detected: boolean;
      rationale: string;
    };
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
  };
  uncertainty?: {
    score: number;
    type: Array<"epistemic" | "missing_data" | "conflict">;
    sources: {
      model_confidence: number;
      signal_conflict: number;
      missing_fields: number;
    };
  };
};

function buildEventContext(
  overrides: Partial<
    Pick<
      InboxEventInference,
      "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
    >
  > = {}
): Pick<
  InboxEventInference,
  "primaryEventType" | "secondaryTags" | "confidence" | "sensitiveEvent"
> {
  return {
    primaryEventType: overrides.primaryEventType ?? "newsletter",
    secondaryTags: overrides.secondaryTags ?? [],
    confidence: overrides.confidence ?? 76,
    sensitiveEvent: overrides.sensitiveEvent ?? {
      detected: false,
      family: null,
      confidence: 0,
      attentionBoost: 0,
      securityBoost: 0,
      mustNotMissScore: 0,
      timeSensitivity: "low",
      routeHint: null,
      rationale: "fixture default",
      guardrails: [],
    },
  };
}

function buildAxes(args: {
  attentionLevel: "none" | "low" | "medium" | "high" | "urgent";
  securityLevel: "benign" | "noisy" | "suspicious" | "harmful" | "critical";
  actionRoute: "suppress" | "surface" | "escalate" | "quarantine" | "block";
  attentionDrivers?: string[];
  securityDrivers?: string[];
  routeRationale?: string;
  trustedAction?: "allow" | "escalate" | "quarantine" | "block";
}): InboxDecisionAxes {
  return {
    attentionPriority: {
      level: args.attentionLevel,
      score: args.attentionLevel === "urgent" ? 95 : args.attentionLevel === "high" ? 82 : 34,
      legacyPriorityBand:
        args.attentionLevel === "high" || args.attentionLevel === "urgent"
          ? "high"
          : args.attentionLevel === "medium"
            ? "medium"
            : "low",
      attentionType:
        args.attentionLevel === "urgent"
          ? "act_now"
          : args.attentionLevel === "high"
            ? "review_later"
            : "ignore_routine",
      rationale: "Fixture attention rationale.",
      drivers:
        args.attentionDrivers ??
        (args.attentionLevel === "high" || args.attentionLevel === "urgent"
          ? ["high user relevance"]
          : ["noise outweighs urgency"]),
    },
    securitySeverity: {
      level: args.securityLevel,
      score:
        args.securityLevel === "critical"
          ? 96
          : args.securityLevel === "harmful"
            ? 82
            : args.securityLevel === "suspicious"
              ? 62
              : args.securityLevel === "noisy"
                ? 28
                : 12,
      threatType:
        args.securityLevel === "critical" || args.securityLevel === "harmful"
          ? "phishing"
          : args.securityLevel === "suspicious"
            ? "unknown"
            : "none",
      legacyRiskLevel:
        args.securityLevel === "critical" || args.securityLevel === "harmful"
          ? "high"
          : args.securityLevel === "suspicious"
            ? "medium"
            : "low",
      rationale: "Fixture security rationale.",
      drivers: args.securityDrivers ?? ["structured security signal"],
    },
    actionRoute: {
      route: args.actionRoute,
      legacyRoutingAction:
        args.actionRoute === "escalate" ? "escalate" : "auto_triage",
      trustedAction: args.trustedAction ?? "allow",
      source: "routing_policy",
      humanAttentionRequired:
        args.actionRoute === "surface" || args.actionRoute === "escalate",
      rationale: args.routeRationale ?? "Fixture route rationale.",
    },
  };
}

function buildExplanationFixture(args: BuildExplanationFixtureArgs) {
  const signalGroups = buildSignalGroups({
    categoryScores: [
      {
        category: args.primaryCategory,
        score: 88,
        reason: "Fixture top category score.",
      },
    ],
    riskTags: args.riskTags ?? [],
    signals: args.signals ?? [],
    trustScore: args.trustScore ?? 72,
    reputationScore: args.reputationScore ?? 74,
    reputationFindings: [],
    thread: {
      depth: 2,
      riskDensity: 0.4,
    },
    extracted: {
      deadlines: [],
      moneyMentions: [],
      urls: [],
      attachments: [],
      attachmentRiskScore: args.attachmentRiskScore ?? 0,
    },
    guardrails: {
      ruleHits: args.ruleHits ?? [],
      rationale: args.guardrailRationale ?? "Fixture guardrail rationale.",
    },
    decisionImportance:
      args.decisionImportance ?? {
        threatScore: 24,
        urgencyScore: 38,
        relevanceScore: 44,
        opportunityScore: 22,
        noiseScore: 30,
        trustGapScore: 18,
        affinityScore: 20,
        attentionType: "review_later",
        rationale: "Fixture decision-importance rationale.",
      },
    classifier: {
      modelVersion: "test-fixture",
      predictedClass: "informational",
      probabilities:
        args.classifierProbabilities ?? {
          spam: 0.08,
          harmful: 0.05,
          actionable: 0.22,
          informational: 0.65,
        },
      memorySampleCount: args.memorySampleCount ?? 0,
      rationale: "Fixture classifier rationale.",
    },
    consensus: {
      score: args.trustedDecisionRisk,
      note: "Fixture consensus note.",
      strength: 0.86,
      disagreementFlags: [],
    },
  });

  return buildExplanation({
    primaryCategory: args.primaryCategory,
    priorityScore: args.priorityScore,
    trustedDecision: {
      action: args.trustedDecisionAction,
      riskScore: args.trustedDecisionRisk,
    },
    signalGroups,
    uncertainty:
      args.uncertainty ?? {
        score: 0.14,
        type: [],
        sources: {
          model_confidence: 0.86,
          signal_conflict: 0.08,
          missing_fields: 0,
        },
      },
    decisionAxes: args.decisionAxes,
    decision: args.decision,
    eventContext: args.eventContext,
    falsePositiveGuard: args.falsePositiveGuard,
    temporalContext: args.temporalContext,
    urgencyPrediction: args.urgencyPrediction,
  });
}

test("stale urgency suppression creates an auditable score reducer", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "deadline_scheduling",
    priorityScore: 34,
    trustedDecisionAction: "allow",
    trustedDecisionRisk: 22,
    ruleHits: ["stale_urgency_decay"],
    decisionAxes: buildAxes({
      attentionLevel: "low",
      securityLevel: "benign",
      actionRoute: "suppress",
      attentionDrivers: ["stale urgency no longer justifies review"],
      securityDrivers: ["no direct threat"],
      routeRationale: "Expired deadline no longer justifies surfacing.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "Expired deadline no longer justifies surfacing.",
      risk_level: "low",
    },
    falsePositiveGuard: {
      guardActivated: true,
      corrections: [
        {
          rule: "stale_urgency_decay",
          delta: -18,
          reason:
            "2 extracted deadlines already passed, so urgency should decay instead of keeping the message elevated.",
        },
      ],
    },
  });

  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "stale_urgency_decay"
    )
  );
  assert.ok(explanation.auditTrail.scoreReducers.includes("Stale urgency decay"));
  assert.match(explanation.summary, /Suppressed/i);
});

test("dangerous email quarantined with low user attention explains containment clearly", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "scam_credential_phishing",
    priorityScore: 38,
    trustedDecisionAction: "quarantine",
    trustedDecisionRisk: 96,
    riskTags: ["Credential Phishing", "Impersonation"],
    attachmentRiskScore: 68,
    classifierProbabilities: {
      spam: 0.02,
      harmful: 0.91,
      actionable: 0.04,
      informational: 0.03,
    },
    decisionAxes: buildAxes({
      attentionLevel: "low",
      securityLevel: "critical",
      actionRoute: "quarantine",
      securityDrivers: ["credential phishing indicators", "attachment risk"],
      trustedAction: "quarantine",
      routeRationale: "Containment is safer than surfacing the message.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "The message is already being quarantined.",
      risk_level: "high",
    },
    eventContext: buildEventContext({
      primaryEventType: "phishing_or_impersonation",
      confidence: 93,
    }),
  });

  assert.match(
    explanation.summary,
    /Dangerous, but user attention was not requested because Aegis already contained it/i
  );
  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "security_signal"
    )
  );
  assert.ok(explanation.auditTrail.routeDrivers.includes("Route: Quarantine"));
});

test("OTP surfaced due to sensitive-event detection is explained as safe but important", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "ops_support",
    priorityScore: 84,
    trustedDecisionAction: "allow",
    trustedDecisionRisk: 18,
    decisionAxes: buildAxes({
      attentionLevel: "high",
      securityLevel: "benign",
      actionRoute: "surface",
      attentionDrivers: ["login code expires quickly"],
      securityDrivers: ["known auth flow"],
      routeRationale: "Surface the code so the user can decide quickly.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "Direct surface is safe and useful.",
      risk_level: "low",
    },
    eventContext: buildEventContext({
      primaryEventType: "login_code",
      secondaryTags: ["auth_otp"],
      confidence: 97,
      sensitiveEvent: {
        detected: true,
        family: "auth_flow",
        confidence: 97,
        attentionBoost: 24,
        securityBoost: 0,
        mustNotMissScore: 98,
        timeSensitivity: "expires_soon",
        routeHint: "surface",
        rationale: "High-confidence auth-flow detection.",
        guardrails: [],
      },
    }),
  });

  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "event_detected"
    )
  );
  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "sensitive_event"
    )
  );
  assert.ok(
    explanation.auditTrail.attentionDrivers.includes(
      "Sensitive-event boost: Auth Flow"
    )
  );
  assert.match(explanation.summary, /Safe but important/i);
});

test("promo mail suppressed because of repetitive low-value history stays clearly non-harmful", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "sales_marketing",
    priorityScore: 18,
    trustedDecisionAction: "allow",
    trustedDecisionRisk: 14,
    ruleHits: ["learning_promo_fatigue"],
    memorySampleCount: 6,
    decisionImportance: {
      threatScore: 8,
      urgencyScore: 12,
      relevanceScore: 14,
      opportunityScore: 18,
      noiseScore: 82,
      trustGapScore: 10,
      affinityScore: 46,
      attentionType: "ignore_routine",
      rationale: "Repeated low-value promotional pattern.",
    },
    decisionAxes: buildAxes({
      attentionLevel: "low",
      securityLevel: "noisy",
      actionRoute: "suppress",
      attentionDrivers: ["routine promotional noise"],
      securityDrivers: ["no harmful indicator"],
      routeRationale: "Suppress repetitive promo noise.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "Suppress repetitive low-value promo noise.",
      risk_level: "low",
    },
    eventContext: buildEventContext({
      primaryEventType: "promotional_commerce",
      secondaryTags: ["bulk_marketing"],
      confidence: 88,
    }),
    falsePositiveGuard: {
      guardActivated: true,
      corrections: [
        {
          rule: "trusted_bulk_bleed_correction",
          delta: -16,
          reason:
            "Trusted sender identity is being treated as stronger evidence than the bulk promotional pattern actually warrants.",
        },
      ],
    },
  });

  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "promo_suppression"
    )
  );
  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "user_feedback_history"
    )
  );
  assert.ok(
    explanation.auditTrail.scoreReducers.includes("Promotional suppression")
  );
  assert.match(explanation.summary, /Suppressed/i);
});

test("pattern novelty from predictive urgency becomes an auditable fragment", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "finance_payment",
    priorityScore: 76,
    trustedDecisionAction: "allow",
    trustedDecisionRisk: 34,
    decisionAxes: buildAxes({
      attentionLevel: "high",
      securityLevel: "benign",
      actionRoute: "surface",
      attentionDrivers: ["new subject pattern from an established sender"],
      securityDrivers: ["no direct threat"],
      routeRationale: "Surface because the sender pattern looks materially different.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "Surface due to changed sender pattern.",
      risk_level: "low",
    },
    urgencyPrediction: {
      temporalContext: "standard",
      predictionConfidence: 84,
      predictionFactors: [
        {
          factor: "P4_subject_trajectory",
          direction: "boost",
          magnitude: 7,
          rationale:
            "Novel hashed subject pattern within the current batch suggests a meaningful change from this sender.",
        },
      ],
    },
  });

  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "pattern_novelty"
    )
  );
  assert.ok(
    explanation.auditTrail.attentionDrivers.includes("Subject-pattern novelty")
  );
});

test("job update surfaced despite low security severity remains auditable", () => {
  const explanation = buildExplanationFixture({
    primaryCategory: "ops_support",
    priorityScore: 78,
    trustedDecisionAction: "allow",
    trustedDecisionRisk: 20,
    decisionAxes: buildAxes({
      attentionLevel: "high",
      securityLevel: "benign",
      actionRoute: "surface",
      attentionDrivers: ["job update requires review"],
      securityDrivers: ["no security concern"],
      routeRationale: "Surface the workflow update to the user.",
    }),
    decision: {
      final_action: "auto_triage",
      reason: "Workflow update should be surfaced directly.",
      risk_level: "low",
    },
    eventContext: buildEventContext({
      primaryEventType: "job_application_update",
      secondaryTags: ["recruiter_reply"],
      confidence: 86,
    }),
  });

  assert.ok(
    explanation.reasonFragments.some(
      (fragment) => fragment.type === "event_detected"
    )
  );
  assert.ok(
    explanation.auditTrail.attentionDrivers.includes(
      "Job update requires review"
    )
  );
  assert.match(explanation.summary, /Safe but important/i);
});
