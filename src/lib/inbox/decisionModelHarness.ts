import { buildExplanation, buildSignalGroups } from "./compatibility";
import {
  buildDecisionAxes,
  deriveAttentionPriority,
  deriveSecuritySeverity,
  type AttentionPriorityLevel,
  type InboxDecisionAxes,
  type SecuritySeverityLevel,
} from "./decisionAxes";
import { buildDecisionCapsule, type DecisionCapsule } from "./decisionCapsule";
import { routeInboxDecision, type InboxDecision } from "./decision";
import {
  inferInboxEvent,
  type InboxEventInference,
  type InboxEventType,
} from "./eventTaxonomy";
import type { DecisionImportanceProfile } from "./importance";
import type { InboxMailClass, InboxThreatType } from "./schemas";

type ExtractedFixture = {
  deadlines: string[];
  moneyMentions: string[];
  urls: string[];
  attachments: string[];
  attachmentRiskScore: number;
};

type CategoryScoreFixture = {
  category: string;
  score: number;
  reason: string;
};

type BenchmarkFixture = {
  id: string;
  label: string;
  email: {
    subject: string;
    body: string;
    senderEmail: string;
    senderDomain: string;
    extracted: ExtractedFixture;
  };
  scoring: {
    primaryCategory: string;
    categoryScores: CategoryScoreFixture[];
    riskTags: string[];
    signals: string[];
    trustScore: number;
    reputationScore: number;
    decisionImportance: DecisionImportanceProfile;
    promotional: {
      lowRiskPromotional: boolean;
      promotionalConfidence: number;
      promoUrgencyHits: number;
      senderPromoHints: number;
    };
    temporalFlags?: string[];
  };
  legacy: {
    priorityScore: number;
    priorityBand: "high" | "medium" | "low";
    trustedAction: "allow" | "escalate" | "quarantine" | "block";
    confidencePct: number;
    riskScore: number;
    uncertaintyPercent: number;
    threatType: InboxThreatType;
    mailClass: InboxMailClass;
    classifier: {
      harmful: number;
      actionable: number;
      informational: number;
      spam: number;
    };
    disagreementFlags?: string[];
  };
  expected: {
    attentionPositive: boolean;
    harmful: boolean;
    transactionalEvent: boolean;
    authEvent: boolean;
    jobUpdate: boolean;
    promoNoise: boolean;
    importantBenign: boolean;
    expectedEventTypes: InboxEventType[];
  };
};

type LegacyBaselineResult = {
  attentionPositive: boolean;
  harmfulPositive: boolean;
  promoSuppressed: boolean;
};

export type DecisionBenchmarkResult = {
  fixtureId: string;
  label: string;
  eventContext: InboxEventInference;
  decision: InboxDecision;
  decisionAxes: InboxDecisionAxes;
  decisionCapsule: DecisionCapsule;
  explanationSummary: string;
  legacyBaseline: LegacyBaselineResult;
  expected: BenchmarkFixture["expected"];
  uncertaintyPercent: number;
};

export type DecisionBenchmarkMetrics = {
  sampleSize: number;
  newModel: {
    attentionPrecision: number;
    attentionRecall: number;
    harmfulDetectionPrecision: number;
    harmfulDetectionRecall: number;
    transactionalEventRecall: number;
    authenticationEventRecall: number;
    jobUpdateRecall: number;
    promoSuppressionPrecision: number;
    falsePositiveRateOnImportantBenignMail: number;
    explanationCapsuleCoverage: number;
    uncertaintyTriggeredHumanReviewRate: number;
  };
  legacyBaseline: {
    attentionPrecision: number;
    attentionRecall: number;
    harmfulDetectionPrecision: number;
    harmfulDetectionRecall: number;
    promoSuppressionPrecision: number;
    falsePositiveRateOnImportantBenignMail: number;
  };
};

const AUTH_EVENTS = new Set<InboxEventType>([
  "auth_otp",
  "login_code",
  "password_reset",
  "password_changed",
  "account_recovery",
]);

const TRANSACTIONAL_EVENTS = new Set<InboxEventType>([
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

const JOB_EVENTS = new Set<InboxEventType>([
  "job_application_update",
  "interview_update",
  "interview_scheduled",
  "recruiter_reply",
]);

/**
 * Clamps percentages and bounded scores into a stable range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Formats one ratio as a two-decimal percentage.
 */
function toPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/**
 * Returns true when the attention level means the user should care enough to surface the mail.
 */
function isAttentionPositive(level: AttentionPriorityLevel): boolean {
  return level === "medium" || level === "high" || level === "urgent";
}

/**
 * Returns true when the new security axis marks the mail as materially harmful.
 */
function isHarmfulSeverity(level: SecuritySeverityLevel): boolean {
  return level === "harmful" || level === "critical";
}

/**
 * Returns true when the inferred event set includes at least one event from the requested family.
 */
function hasEventFamily(
  eventContext: InboxEventInference,
  family: Set<InboxEventType>
) {
  return (
    family.has(eventContext.primaryEventType) ||
    eventContext.secondaryTags.some((tag) => family.has(tag))
  );
}

/**
 * Returns true when the event inference hit one of the expected canonical event types.
 */
function hasExpectedEvent(
  eventContext: InboxEventInference,
  expectedEventTypes: InboxEventType[]
): boolean {
  return (
    expectedEventTypes.includes(eventContext.primaryEventType) ||
    eventContext.secondaryTags.some((tag) => expectedEventTypes.includes(tag))
  );
}

/**
 * Builds a conservative legacy baseline from the old scalar model so the new decision layer can be compared against it.
 */
function buildLegacyBaseline(fixture: BenchmarkFixture): LegacyBaselineResult {
  return {
    attentionPositive: fixture.legacy.priorityBand !== "low",
    harmfulPositive:
      fixture.legacy.mailClass === "harmful" ||
      fixture.legacy.trustedAction === "quarantine" ||
      fixture.legacy.trustedAction === "block",
    promoSuppressed:
      (fixture.scoring.primaryCategory === "sales_marketing" ||
        fixture.scoring.primaryCategory === "newsletter") &&
      fixture.legacy.priorityBand === "low" &&
      fixture.legacy.trustedAction === "allow",
  };
}

/**
 * Builds one deterministic uncertainty payload for explanation and capsule generation.
 */
function buildFixtureUncertainty(fixture: BenchmarkFixture) {
  const score = clamp(fixture.legacy.uncertaintyPercent / 100, 0, 1);
  return {
    score,
    type:
      score >= 0.55
        ? (["epistemic"] as Array<"epistemic" | "missing_data" | "conflict">)
        : [],
    sources: {
      model_confidence: clamp(
        1 -
          Math.max(
            fixture.legacy.classifier.harmful,
            fixture.legacy.classifier.actionable,
            fixture.legacy.classifier.informational,
            fixture.legacy.classifier.spam
          ),
        0,
        1
      ),
      signal_conflict:
        fixture.legacy.disagreementFlags &&
        fixture.legacy.disagreementFlags.length > 0
          ? 0.42
          : 0.12,
      missing_fields: 0,
    },
  };
}

/**
 * Runs one benchmark fixture through the deterministic event, decision-axis, explanation, and capsule stack.
 */
export function runDecisionBenchmarkFixture(
  fixture: BenchmarkFixture
): DecisionBenchmarkResult {
  const eventContext = inferInboxEvent({
    email: {
      subject: fixture.email.subject,
      body: fixture.email.body,
      senderEmail: fixture.email.senderEmail,
      senderDomain: fixture.email.senderDomain,
      extracted: fixture.email.extracted,
    },
    scoring: {
      primaryCategory: fixture.scoring.primaryCategory,
      riskTags: fixture.scoring.riskTags,
      trustScore: fixture.scoring.trustScore,
      reputationScore: fixture.scoring.reputationScore,
      promotional: fixture.scoring.promotional,
      decisionImportance: fixture.scoring.decisionImportance,
    },
  });

  const precomputedAttentionPriority = deriveAttentionPriority({
    primaryCategory: fixture.scoring.primaryCategory,
    priorityScore: fixture.legacy.priorityScore,
    priorityBand: fixture.legacy.priorityBand,
    mailClass: fixture.legacy.mailClass,
    decisionImportance: fixture.scoring.decisionImportance,
    trustedDecision: {
      action: fixture.legacy.trustedAction,
      riskScore: fixture.legacy.riskScore,
    },
    legacyRiskLevel:
      fixture.legacy.riskScore >= 70
        ? "high"
        : fixture.legacy.riskScore >= 40
          ? "medium"
          : "low",
    threatType: fixture.legacy.threatType,
    classifier: {
      probabilities: fixture.legacy.classifier,
    },
    extracted: {
      attachmentRiskScore: fixture.email.extracted.attachmentRiskScore,
      urls: fixture.email.extracted.urls,
      deadlines: fixture.email.extracted.deadlines,
    },
    riskTags: fixture.scoring.riskTags,
    subject: fixture.email.subject,
    bodyPreview: fixture.email.body,
    temporalFlags: fixture.scoring.temporalFlags ?? [],
    eventContext,
  });
  const precomputedSecuritySeverity = deriveSecuritySeverity({
    primaryCategory: fixture.scoring.primaryCategory,
    priorityScore: fixture.legacy.priorityScore,
    priorityBand: fixture.legacy.priorityBand,
    mailClass: fixture.legacy.mailClass,
    decisionImportance: fixture.scoring.decisionImportance,
    trustedDecision: {
      action: fixture.legacy.trustedAction,
      riskScore: fixture.legacy.riskScore,
    },
    legacyRiskLevel:
      fixture.legacy.riskScore >= 70
        ? "high"
        : fixture.legacy.riskScore >= 40
          ? "medium"
          : "low",
    threatType: fixture.legacy.threatType,
    classifier: {
      probabilities: fixture.legacy.classifier,
    },
    extracted: {
      attachmentRiskScore: fixture.email.extracted.attachmentRiskScore,
      urls: fixture.email.extracted.urls,
      deadlines: fixture.email.extracted.deadlines,
    },
    riskTags: fixture.scoring.riskTags,
    subject: fixture.email.subject,
    bodyPreview: fixture.email.body,
    temporalFlags: fixture.scoring.temporalFlags ?? [],
    eventContext,
  });

  const decision = routeInboxDecision({
    confidencePct: fixture.legacy.confidencePct,
    uncertaintyPercent: fixture.legacy.uncertaintyPercent,
    riskScore: fixture.legacy.riskScore,
    attentionPriorityLevel: precomputedAttentionPriority.level,
    securitySeverityLevel: precomputedSecuritySeverity.level,
    trustedAction: fixture.legacy.trustedAction,
    disagreementFlags: fixture.legacy.disagreementFlags ?? [],
  });

  const decisionAxes = buildDecisionAxes({
    primaryCategory: fixture.scoring.primaryCategory,
    priorityScore: fixture.legacy.priorityScore,
    priorityBand: fixture.legacy.priorityBand,
    mailClass: fixture.legacy.mailClass,
    decisionImportance: fixture.scoring.decisionImportance,
    trustedDecision: {
      action: fixture.legacy.trustedAction,
      riskScore: fixture.legacy.riskScore,
    },
    decision,
    threatType: fixture.legacy.threatType,
    classifier: {
      probabilities: fixture.legacy.classifier,
    },
    extracted: {
      attachmentRiskScore: fixture.email.extracted.attachmentRiskScore,
      urls: fixture.email.extracted.urls,
      deadlines: fixture.email.extracted.deadlines,
    },
    riskTags: fixture.scoring.riskTags,
    subject: fixture.email.subject,
    bodyPreview: fixture.email.body,
    temporalFlags: fixture.scoring.temporalFlags ?? [],
    eventContext,
    precomputedAttentionPriority,
    precomputedSecuritySeverity,
  });

  const signalGroups = buildSignalGroups({
    categoryScores: fixture.scoring.categoryScores,
    riskTags: fixture.scoring.riskTags,
    signals: fixture.scoring.signals,
    trustScore: fixture.scoring.trustScore,
    reputationScore: fixture.scoring.reputationScore,
    reputationFindings: [],
    thread: {
      depth: 1,
      riskDensity: 0,
    },
    extracted: fixture.email.extracted,
    guardrails: {
      ruleHits: [],
      rationale: "Fixture benchmark input.",
    },
    decisionImportance: fixture.scoring.decisionImportance,
    classifier: {
      modelVersion: "benchmark-fixture",
      predictedClass: fixture.legacy.mailClass,
      probabilities: fixture.legacy.classifier,
      memorySampleCount: 0,
      rationale: "Fixture classifier snapshot.",
    },
    consensus: {
      score: fixture.legacy.riskScore,
      note: "Deterministic fixture consensus.",
      strength: clamp(fixture.legacy.confidencePct / 100, 0, 1),
      disagreementFlags: fixture.legacy.disagreementFlags ?? [],
    },
  });

  const uncertainty = buildFixtureUncertainty(fixture);
  const explanation = buildExplanation({
    primaryCategory: fixture.scoring.primaryCategory,
    priorityScore: fixture.legacy.priorityScore,
    trustedDecision: {
      action: fixture.legacy.trustedAction,
      riskScore: fixture.legacy.riskScore,
    },
    signalGroups,
    uncertainty,
    decisionAxes,
    decision,
    eventContext,
  });

  const decisionCapsule = buildDecisionCapsule({
    eventContext,
    attentionPriority: decisionAxes.attentionPriority.level,
    securitySeverity: decisionAxes.securitySeverity.level,
    actionRoute: decisionAxes.actionRoute.route,
    uncertainty,
    extracted: fixture.email.extracted,
  });

  return {
    fixtureId: fixture.id,
    label: fixture.label,
    eventContext,
    decision,
    decisionAxes,
    decisionCapsule,
    explanationSummary: explanation.summary,
    legacyBaseline: buildLegacyBaseline(fixture),
    expected: fixture.expected,
    uncertaintyPercent: fixture.legacy.uncertaintyPercent,
  };
}

/**
 * Computes the requested decision-layer quality metrics from one benchmark run.
 */
export function computeDecisionBenchmarkMetrics(
  results: DecisionBenchmarkResult[]
): DecisionBenchmarkMetrics {
  const newAttentionPredicted = results.filter((result) =>
    isAttentionPositive(result.decisionAxes.attentionPriority.level)
  );
  const expectedAttention = results.filter((result) => result.expected.attentionPositive);
  const correctAttention = newAttentionPredicted.filter(
    (result) => result.expected.attentionPositive
  );
  const recoveredAttention = expectedAttention.filter((result) =>
    isAttentionPositive(result.decisionAxes.attentionPriority.level)
  );

  const newHarmfulPredicted = results.filter((result) =>
    isHarmfulSeverity(result.decisionAxes.securitySeverity.level)
  );
  const expectedHarmful = results.filter((result) => result.expected.harmful);
  const correctHarmful = newHarmfulPredicted.filter((result) => result.expected.harmful);
  const recoveredHarmful = expectedHarmful.filter((result) =>
    isHarmfulSeverity(result.decisionAxes.securitySeverity.level)
  );

  const transactionalExpected = results.filter(
    (result) => result.expected.transactionalEvent
  );
  const authExpected = results.filter((result) => result.expected.authEvent);
  const jobExpected = results.filter((result) => result.expected.jobUpdate);
  const suppressedResults = results.filter(
    (result) => result.decisionAxes.actionRoute.route === "suppress"
  );
  const importantBenignExpected = results.filter(
    (result) => result.expected.importantBenign
  );
  const importantBenignErrors = importantBenignExpected.filter(
    (result) =>
      result.decisionAxes.actionRoute.route === "suppress" ||
      isHarmfulSeverity(result.decisionAxes.securitySeverity.level) ||
      !isAttentionPositive(result.decisionAxes.attentionPriority.level)
  );
  const coverageHits = results.filter(
    (result) =>
      result.explanationSummary.trim().length > 0 &&
      result.decisionCapsule.headline.trim().length > 0 &&
      result.decisionCapsule.shortRationale.trim().length > 0 &&
      result.decisionCapsule.safeNextStep.trim().length > 0
  );
  const uncertainResults = results.filter((result) => result.uncertaintyPercent >= 45);
  const uncertainHumanReview = uncertainResults.filter(
    (result) => result.decision.final_action === "human_review"
  );

  const legacyAttentionPredicted = results.filter(
    (result) => result.legacyBaseline.attentionPositive
  );
  const legacyCorrectAttention = legacyAttentionPredicted.filter(
    (result) => result.expected.attentionPositive
  );
  const legacyRecoveredAttention = expectedAttention.filter(
    (result) => result.legacyBaseline.attentionPositive
  );
  const legacyHarmfulPredicted = results.filter(
    (result) => result.legacyBaseline.harmfulPositive
  );
  const legacyCorrectHarmful = legacyHarmfulPredicted.filter(
    (result) => result.expected.harmful
  );
  const legacyRecoveredHarmful = expectedHarmful.filter(
    (result) => result.legacyBaseline.harmfulPositive
  );
  const legacySuppressedPromo = results.filter(
    (result) => result.legacyBaseline.promoSuppressed
  );
  const legacyImportantBenignErrors = importantBenignExpected.filter(
    (result) =>
      !result.legacyBaseline.attentionPositive || result.legacyBaseline.harmfulPositive
  );

  return {
    sampleSize: results.length,
    newModel: {
      attentionPrecision: toPercent(
        correctAttention.length,
        newAttentionPredicted.length
      ),
      attentionRecall: toPercent(
        recoveredAttention.length,
        expectedAttention.length
      ),
      harmfulDetectionPrecision: toPercent(
        correctHarmful.length,
        newHarmfulPredicted.length
      ),
      harmfulDetectionRecall: toPercent(
        recoveredHarmful.length,
        expectedHarmful.length
      ),
      transactionalEventRecall: toPercent(
        transactionalExpected.filter((result) =>
          hasEventFamily(result.eventContext, TRANSACTIONAL_EVENTS) ||
          hasExpectedEvent(result.eventContext, result.expected.expectedEventTypes)
        ).length,
        transactionalExpected.length
      ),
      authenticationEventRecall: toPercent(
        authExpected.filter((result) =>
          hasEventFamily(result.eventContext, AUTH_EVENTS) ||
          hasExpectedEvent(result.eventContext, result.expected.expectedEventTypes)
        ).length,
        authExpected.length
      ),
      jobUpdateRecall: toPercent(
        jobExpected.filter((result) =>
          hasEventFamily(result.eventContext, JOB_EVENTS) ||
          hasExpectedEvent(result.eventContext, result.expected.expectedEventTypes)
        ).length,
        jobExpected.length
      ),
      promoSuppressionPrecision: toPercent(
        suppressedResults.filter((result) => result.expected.promoNoise).length,
        suppressedResults.length
      ),
      falsePositiveRateOnImportantBenignMail: toPercent(
        importantBenignErrors.length,
        importantBenignExpected.length
      ),
      explanationCapsuleCoverage: toPercent(coverageHits.length, results.length),
      uncertaintyTriggeredHumanReviewRate: toPercent(
        uncertainHumanReview.length,
        uncertainResults.length
      ),
    },
    legacyBaseline: {
      attentionPrecision: toPercent(
        legacyCorrectAttention.length,
        legacyAttentionPredicted.length
      ),
      attentionRecall: toPercent(
        legacyRecoveredAttention.length,
        expectedAttention.length
      ),
      harmfulDetectionPrecision: toPercent(
        legacyCorrectHarmful.length,
        legacyHarmfulPredicted.length
      ),
      harmfulDetectionRecall: toPercent(
        legacyRecoveredHarmful.length,
        expectedHarmful.length
      ),
      promoSuppressionPrecision: toPercent(
        legacySuppressedPromo.filter((result) => result.expected.promoNoise).length,
        legacySuppressedPromo.length
      ),
      falsePositiveRateOnImportantBenignMail: toPercent(
        legacyImportantBenignErrors.length,
        importantBenignExpected.length
      ),
    },
  };
}

/**
 * Renders a readable benchmark report for local tuning and regression checks.
 */
export function formatDecisionBenchmarkReport(
  metrics: DecisionBenchmarkMetrics,
  results: DecisionBenchmarkResult[]
): string {
  const metricRows = [
    ["Attention precision", metrics.legacyBaseline.attentionPrecision, metrics.newModel.attentionPrecision],
    ["Attention recall", metrics.legacyBaseline.attentionRecall, metrics.newModel.attentionRecall],
    [
      "Harmful precision",
      metrics.legacyBaseline.harmfulDetectionPrecision,
      metrics.newModel.harmfulDetectionPrecision,
    ],
    [
      "Harmful recall",
      metrics.legacyBaseline.harmfulDetectionRecall,
      metrics.newModel.harmfulDetectionRecall,
    ],
    [
      "Promo suppression precision",
      metrics.legacyBaseline.promoSuppressionPrecision,
      metrics.newModel.promoSuppressionPrecision,
    ],
    [
      "Important benign false positive rate",
      metrics.legacyBaseline.falsePositiveRateOnImportantBenignMail,
      metrics.newModel.falsePositiveRateOnImportantBenignMail,
    ],
  ];

  const newOnlyRows = [
    ["Transactional event recall", metrics.newModel.transactionalEventRecall],
    ["Authentication-event recall", metrics.newModel.authenticationEventRecall],
    ["Job-update recall", metrics.newModel.jobUpdateRecall],
    ["Explanation/capsule coverage", metrics.newModel.explanationCapsuleCoverage],
    [
      "Uncertainty-triggered human review rate",
      metrics.newModel.uncertaintyTriggeredHumanReviewRate,
    ],
  ];

  const scenarioRows = results.map((result) => {
    return `| ${result.label} | ${result.eventContext.primaryEventType} | ${result.decisionAxes.attentionPriority.level} | ${result.decisionAxes.securitySeverity.level} | ${result.decisionAxes.actionRoute.route} | ${result.decision.final_action} | ${result.decisionCapsule.headline} |`;
  });

  const comparisonTable = [
    "| Metric | Legacy | New | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...metricRows.map(([label, legacy, current]) => {
      const delta = Number((Number(current) - Number(legacy)).toFixed(2));
      return `| ${label} | ${legacy}% | ${current}% | ${delta > 0 ? "+" : ""}${delta}% |`;
    }),
  ].join("\n");

  const newOnlyTable = [
    "| Metric | New |",
    "| --- | ---: |",
    ...newOnlyRows.map(
      ([label, value]) => `| ${label} | ${Number(value).toFixed(2)}% |`
    ),
  ].join("\n");

  const scenarioTable = [
    "| Scenario | Event | Attention | Security | Action Route | Legacy Route | Capsule |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...scenarioRows,
  ].join("\n");

  return [
    "# Aegis Decision Model Benchmark",
    "",
    `Scenarios: ${metrics.sampleSize}`,
    "",
    "## Legacy vs New",
    comparisonTable,
    "",
    "## New-Only Decision-Layer Metrics",
    newOnlyTable,
    "",
    "## Scenario Outcomes",
    scenarioTable,
  ].join("\n");
}

function buildCategoryScores(
  primaryCategory: string,
  primaryScore: number,
  extras: Array<{ category: string; score: number }> = []
): CategoryScoreFixture[] {
  return [
    { category: primaryCategory, score: primaryScore, reason: "fixture primary" },
    ...extras.map((entry) => ({
      category: entry.category,
      score: entry.score,
      reason: "fixture secondary",
    })),
  ];
}

/**
 * Returns the deterministic benchmark fixture set for the Aegis decision model.
 */
export function buildDecisionBenchmarkFixtures(): BenchmarkFixture[] {
  return [
    {
      id: "otp",
      label: "OTP",
      email: {
        subject: "Your verification code",
        body: "Use code 482913 to complete sign-in.",
        senderEmail: "no-reply@accounts.example.com",
        senderDomain: "accounts.example.com",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: [],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 48, [
          { category: "general", score: 18 },
        ]),
        riskTags: [],
        signals: ["verification code detected"],
        trustScore: 72,
        reputationScore: 84,
        decisionImportance: {
          threatScore: 18,
          urgencyScore: 46,
          relevanceScore: 42,
          opportunityScore: 6,
          noiseScore: 14,
          trustGapScore: 10,
          affinityScore: 18,
          attentionType: "review_later",
          rationale: "legacy scalar underweights auth codes",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 42,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 88,
        riskScore: 20,
        uncertaintyPercent: 18,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.04,
          actionable: 0.31,
          informational: 0.59,
          spam: 0.06,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: true,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["auth_otp", "login_code"],
      },
    },
    {
      id: "login-code",
      label: "Login code",
      email: {
        subject: "Login code for your account",
        body: "Use this login code 310044 before it expires.",
        senderEmail: "security@example.com",
        senderDomain: "example.com",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: [],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 46),
        riskTags: [],
        signals: ["login code detected"],
        trustScore: 76,
        reputationScore: 82,
        decisionImportance: {
          threatScore: 16,
          urgencyScore: 44,
          relevanceScore: 40,
          opportunityScore: 4,
          noiseScore: 10,
          trustGapScore: 12,
          affinityScore: 20,
          attentionType: "review_later",
          rationale: "legacy scalar underweights safe login codes",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 44,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 90,
        riskScore: 18,
        uncertaintyPercent: 16,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.03,
          actionable: 0.34,
          informational: 0.58,
          spam: 0.05,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: true,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["login_code", "auth_otp"],
      },
    },
    {
      id: "purchase-confirmation",
      label: "Purchase confirmation",
      email: {
        subject: "Order confirmed",
        body: "Thanks for your order. Your receipt is available in your account.",
        senderEmail: "auto-confirm@store.example",
        senderDomain: "store.example",
        extracted: {
          deadlines: [],
          moneyMentions: ["$84.95"],
          urls: [],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "finance_payment",
        categoryScores: buildCategoryScores("finance_payment", 54),
        riskTags: ["Payment"],
        signals: ["receipt detected"],
        trustScore: 80,
        reputationScore: 86,
        decisionImportance: {
          threatScore: 14,
          urgencyScore: 28,
          relevanceScore: 40,
          opportunityScore: 6,
          noiseScore: 18,
          trustGapScore: 10,
          affinityScore: 26,
          attentionType: "review_later",
          rationale: "legacy scalar treats confirmations as ordinary finance mail",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0.2,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 38,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 84,
        riskScore: 16,
        uncertaintyPercent: 22,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.05,
          actionable: 0.28,
          informational: 0.6,
          spam: 0.07,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: true,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["purchase_confirmed", "receipt_invoice"],
      },
    },
    {
      id: "trusted-invoice-commerce-family",
      label: "Trusted invoice from commerce sender family",
      email: {
        subject: "Your invoice is ready",
        body: "Your invoice for a recent order is available in your account. Prime member updates are also available.",
        senderEmail: "billing@amazon-updates.example",
        senderDomain: "amazon-updates.example",
        extracted: {
          deadlines: [],
          moneyMentions: ["$64.20"],
          urls: ["https://amazon-updates.example/invoice"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "finance_payment",
        categoryScores: buildCategoryScores("finance_payment", 52, [
          { category: "sales_marketing", score: 20 },
        ]),
        riskTags: ["Payment"],
        signals: ["invoice available signal detected"],
        trustScore: 82,
        reputationScore: 86,
        decisionImportance: {
          threatScore: 12,
          urgencyScore: 26,
          relevanceScore: 42,
          opportunityScore: 6,
          noiseScore: 20,
          trustGapScore: 10,
          affinityScore: 28,
          attentionType: "review_later",
          rationale: "trusted commerce family could look partly promotional",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0.8,
          promoUrgencyHits: 0,
          senderPromoHints: 1,
        },
      },
      legacy: {
        priorityScore: 40,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 78,
        riskScore: 16,
        uncertaintyPercent: 24,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.04,
          actionable: 0.25,
          informational: 0.61,
          spam: 0.1,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: true,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["receipt_invoice"],
      },
    },
    {
      id: "shipping-update",
      label: "Shipping update",
      email: {
        subject: "Your order shipped",
        body: "Your package is on the way. Tracking number is now available.",
        senderEmail: "tracking@store.example",
        senderDomain: "store.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://store.example/track"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "general",
        categoryScores: buildCategoryScores("general", 34, [
          { category: "finance_payment", score: 28 },
        ]),
        riskTags: [],
        signals: ["shipping update detected"],
        trustScore: 78,
        reputationScore: 82,
        decisionImportance: {
          threatScore: 8,
          urgencyScore: 24,
          relevanceScore: 38,
          opportunityScore: 4,
          noiseScore: 18,
          trustGapScore: 8,
          affinityScore: 24,
          attentionType: "review_later",
          rationale: "shipping updates used to blend into general updates",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0.1,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 34,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 80,
        riskScore: 12,
        uncertaintyPercent: 24,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.03,
          actionable: 0.24,
          informational: 0.65,
          spam: 0.08,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: true,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["order_shipped"],
      },
    },
    {
      id: "billing-failure",
      label: "Billing failure",
      email: {
        subject: "Payment failed for your subscription",
        body: "We could not process your payment. Update your billing details to keep service active.",
        senderEmail: "billing@service.example",
        senderDomain: "service.example",
        extracted: {
          deadlines: ["keep service active"],
          moneyMentions: [],
          urls: ["https://service.example/billing"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "finance_payment",
        categoryScores: buildCategoryScores("finance_payment", 58, [
          { category: "deadline_scheduling", score: 32 },
        ]),
        riskTags: ["Payment"],
        signals: ["billing issue detected"],
        trustScore: 74,
        reputationScore: 80,
        decisionImportance: {
          threatScore: 22,
          urgencyScore: 42,
          relevanceScore: 48,
          opportunityScore: 6,
          noiseScore: 16,
          trustGapScore: 14,
          affinityScore: 22,
          attentionType: "review_later",
          rationale: "billing failures matter but were not always interruption-worthy",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 48,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 72,
        riskScore: 28,
        uncertaintyPercent: 34,
        threatType: "none",
        mailClass: "actionable",
        classifier: {
          harmful: 0.09,
          actionable: 0.42,
          informational: 0.42,
          spam: 0.07,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: true,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["payment_declined", "billing_issue"],
      },
    },
    {
      id: "password-changed",
      label: "Password changed",
      email: {
        subject: "Your password was changed",
        body: "This is a confirmation that your password was changed recently.",
        senderEmail: "security@provider.example",
        senderDomain: "provider.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: [],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 52),
        riskTags: ["Security"],
        signals: ["password changed signal detected"],
        trustScore: 82,
        reputationScore: 88,
        decisionImportance: {
          threatScore: 24,
          urgencyScore: 34,
          relevanceScore: 42,
          opportunityScore: 4,
          noiseScore: 12,
          trustGapScore: 10,
          affinityScore: 20,
          attentionType: "review_later",
          rationale: "safe but account-critical",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 46,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 78,
        riskScore: 26,
        uncertaintyPercent: 26,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.08,
          actionable: 0.38,
          informational: 0.49,
          spam: 0.05,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: true,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["password_changed"],
      },
    },
    {
      id: "real-password-reset-mixed-promo",
      label: "Real password reset mixed with promo language",
      email: {
        subject: "Reset your password and get back into your account",
        body: "Reset your password with the secure link below. Member offers will still be waiting when you return.",
        senderEmail: "security@store-members.example",
        senderDomain: "store-members.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://store-members.example/reset"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 50, [
          { category: "sales_marketing", score: 18 },
        ]),
        riskTags: ["Security"],
        signals: ["password reset signal detected"],
        trustScore: 78,
        reputationScore: 82,
        decisionImportance: {
          threatScore: 22,
          urgencyScore: 38,
          relevanceScore: 40,
          opportunityScore: 4,
          noiseScore: 18,
          trustGapScore: 14,
          affinityScore: 20,
          attentionType: "review_later",
          rationale: "promo phrasing should not bury a real reset",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 1.2,
          promoUrgencyHits: 0,
          senderPromoHints: 1,
        },
      },
      legacy: {
        priorityScore: 42,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 76,
        riskScore: 22,
        uncertaintyPercent: 28,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.06,
          actionable: 0.32,
          informational: 0.52,
          spam: 0.1,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: true,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["password_reset"],
      },
    },
    {
      id: "benign-account-recovery-weak-wording",
      label: "Benign account recovery notice with weak wording",
      email: {
        subject: "Check your recovery contact details",
        body: "We updated your recovery contact details for your account. Review them if you requested help getting back in.",
        senderEmail: "account-help@provider.example",
        senderDomain: "provider.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://provider.example/recovery"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 44, [
          { category: "general", score: 24 },
        ]),
        riskTags: [],
        signals: ["recovery contact signal detected"],
        trustScore: 80,
        reputationScore: 84,
        decisionImportance: {
          threatScore: 18,
          urgencyScore: 30,
          relevanceScore: 38,
          opportunityScore: 4,
          noiseScore: 16,
          trustGapScore: 12,
          affinityScore: 18,
          attentionType: "review_later",
          rationale: "weak wording but still account-relevant",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 38,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 70,
        riskScore: 18,
        uncertaintyPercent: 30,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.05,
          actionable: 0.24,
          informational: 0.61,
          spam: 0.1,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: true,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["account_recovery"],
      },
    },
    {
      id: "suspicious-login-alert",
      label: "Suspicious login alert",
      email: {
        subject: "Security alert: suspicious sign-in detected",
        body: "We noticed a sign-in attempt from a new device. Review your account if this was not you.",
        senderEmail: "alerts@provider.example",
        senderDomain: "provider.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://provider.example/security"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "security_phishing",
        categoryScores: buildCategoryScores("security_phishing", 62),
        riskTags: ["Security"],
        signals: ["suspicious sign-in signal detected"],
        trustScore: 80,
        reputationScore: 86,
        decisionImportance: {
          threatScore: 44,
          urgencyScore: 58,
          relevanceScore: 48,
          opportunityScore: 2,
          noiseScore: 10,
          trustGapScore: 18,
          affinityScore: 18,
          attentionType: "act_now",
          rationale: "account access anomaly",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 62,
        priorityBand: "medium",
        trustedAction: "allow",
        confidencePct: 76,
        riskScore: 44,
        uncertaintyPercent: 32,
        threatType: "none",
        mailClass: "actionable",
        classifier: {
          harmful: 0.22,
          actionable: 0.46,
          informational: 0.24,
          spam: 0.08,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["login_alert", "security_warning", "new_device_signin"],
      },
    },
    {
      id: "recruiter-reply",
      label: "Recruiter reply",
      email: {
        subject: "Next steps on your application",
        body: "Thank you for your time. The team would like to continue the conversation about the role.",
        senderEmail: "talent@greenhouse.io",
        senderDomain: "greenhouse.io",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: [],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "general",
        categoryScores: buildCategoryScores("general", 32, [
          { category: "ops_support", score: 22 },
        ]),
        riskTags: [],
        signals: ["recruiting workflow signal detected"],
        trustScore: 68,
        reputationScore: 76,
        decisionImportance: {
          threatScore: 6,
          urgencyScore: 26,
          relevanceScore: 44,
          opportunityScore: 12,
          noiseScore: 14,
          trustGapScore: 12,
          affinityScore: 18,
          attentionType: "review_later",
          rationale: "career workflow email with weak legacy urgency",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 40,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 54,
        riskScore: 18,
        uncertaintyPercent: 48,
        threatType: "none",
        mailClass: "informational",
        classifier: {
          harmful: 0.04,
          actionable: 0.29,
          informational: 0.57,
          spam: 0.1,
        },
        disagreementFlags: ["confidence_variance_high"],
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: true,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["recruiter_reply", "job_application_update"],
      },
    },
    {
      id: "interview-update",
      label: "Interview update",
      email: {
        subject: "Schedule your interview",
        body: "Please share your availability so we can schedule the next interview round.",
        senderEmail: "interviews@company.example",
        senderDomain: "company.example",
        extracted: {
          deadlines: ["share your availability"],
          moneyMentions: [],
          urls: ["https://company.example/schedule"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "deadline_scheduling",
        categoryScores: buildCategoryScores("deadline_scheduling", 60, [
          { category: "general", score: 20 },
        ]),
        riskTags: ["Deadline Pressure"],
        signals: ["interview scheduling signal detected"],
        trustScore: 72,
        reputationScore: 78,
        decisionImportance: {
          threatScore: 8,
          urgencyScore: 54,
          relevanceScore: 58,
          opportunityScore: 12,
          noiseScore: 10,
          trustGapScore: 12,
          affinityScore: 16,
          attentionType: "act_now",
          rationale: "interview scheduling is time-sensitive and personal",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 58,
        priorityBand: "medium",
        trustedAction: "allow",
        confidencePct: 68,
        riskScore: 22,
        uncertaintyPercent: 28,
        threatType: "none",
        mailClass: "actionable",
        classifier: {
          harmful: 0.03,
          actionable: 0.58,
          informational: 0.31,
          spam: 0.08,
        },
      },
      expected: {
        attentionPositive: true,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: true,
        promoNoise: false,
        importantBenign: true,
        expectedEventTypes: ["interview_update", "interview_scheduled"],
      },
    },
    {
      id: "temu-promo",
      label: "Temu-style promo",
      email: {
        subject: "Temu flash sale ends tonight",
        body: "Limited time deal. Shop now and save 80% with this coupon.",
        senderEmail: "promo@temu.example",
        senderDomain: "temu.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://temu.example/shop"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "sales_marketing",
        categoryScores: buildCategoryScores("sales_marketing", 64, [
          { category: "newsletter", score: 44 },
        ]),
        riskTags: [],
        signals: ["promo sale language detected"],
        trustScore: 64,
        reputationScore: 72,
        decisionImportance: {
          threatScore: 6,
          urgencyScore: 18,
          relevanceScore: 14,
          opportunityScore: 6,
          noiseScore: 82,
          trustGapScore: 10,
          affinityScore: 10,
          attentionType: "ignore_routine",
          rationale: "clear promo noise",
        },
        promotional: {
          lowRiskPromotional: true,
          promotionalConfidence: 3.8,
          promoUrgencyHits: 2,
          senderPromoHints: 3,
        },
      },
      legacy: {
        priorityScore: 28,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 90,
        riskScore: 12,
        uncertaintyPercent: 20,
        threatType: "none",
        mailClass: "spam",
        classifier: {
          harmful: 0.02,
          actionable: 0.08,
          informational: 0.18,
          spam: 0.72,
        },
      },
      expected: {
        attentionPositive: false,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: true,
        importantBenign: false,
        expectedEventTypes: ["promotional_commerce", "bulk_marketing"],
      },
    },
    {
      id: "rakuten-promo",
      label: "Rakuten-style promo",
      email: {
        subject: "Cash back bonus this weekend",
        body: "Exclusive offer, limited-time shopping bonus, and featured deals just for you.",
        senderEmail: "deals@rakuten.example",
        senderDomain: "rakuten.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://rakuten.example/deals"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "sales_marketing",
        categoryScores: buildCategoryScores("sales_marketing", 58, [
          { category: "newsletter", score: 40 },
        ]),
        riskTags: [],
        signals: ["cash back promo detected"],
        trustScore: 66,
        reputationScore: 74,
        decisionImportance: {
          threatScore: 4,
          urgencyScore: 16,
          relevanceScore: 18,
          opportunityScore: 8,
          noiseScore: 76,
          trustGapScore: 8,
          affinityScore: 12,
          attentionType: "ignore_routine",
          rationale: "promo digest",
        },
        promotional: {
          lowRiskPromotional: true,
          promotionalConfidence: 3.2,
          promoUrgencyHits: 1,
          senderPromoHints: 2,
        },
      },
      legacy: {
        priorityScore: 30,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 88,
        riskScore: 12,
        uncertaintyPercent: 18,
        threatType: "none",
        mailClass: "spam",
        classifier: {
          harmful: 0.02,
          actionable: 0.09,
          informational: 0.2,
          spam: 0.69,
        },
      },
      expected: {
        attentionPositive: false,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: true,
        importantBenign: false,
        expectedEventTypes: ["promotional_commerce", "bulk_marketing"],
      },
    },
    {
      id: "harmless-newsletter",
      label: "Harmless newsletter",
      email: {
        subject: "Weekly product digest",
        body: "Newsletter update, community highlights, and product news from this week.",
        senderEmail: "digest@community.example",
        senderDomain: "community.example",
        extracted: {
          deadlines: [],
          moneyMentions: [],
          urls: ["https://community.example/news"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "newsletter",
        categoryScores: buildCategoryScores("newsletter", 62, [
          { category: "general", score: 18 },
        ]),
        riskTags: [],
        signals: ["newsletter signature detected"],
        trustScore: 70,
        reputationScore: 76,
        decisionImportance: {
          threatScore: 4,
          urgencyScore: 10,
          relevanceScore: 16,
          opportunityScore: 4,
          noiseScore: 78,
          trustGapScore: 8,
          affinityScore: 14,
          attentionType: "ignore_routine",
          rationale: "routine digest",
        },
        promotional: {
          lowRiskPromotional: true,
          promotionalConfidence: 2.4,
          promoUrgencyHits: 0,
          senderPromoHints: 1,
        },
      },
      legacy: {
        priorityScore: 24,
        priorityBand: "low",
        trustedAction: "allow",
        confidencePct: 42,
        riskScore: 18,
        uncertaintyPercent: 60,
        threatType: "none",
        mailClass: "spam",
        classifier: {
          harmful: 0.02,
          actionable: 0.05,
          informational: 0.23,
          spam: 0.7,
        },
        disagreementFlags: ["partial_model_failure"],
      },
      expected: {
        attentionPositive: false,
        harmful: false,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: true,
        importantBenign: false,
        expectedEventTypes: ["newsletter"],
      },
    },
    {
      id: "phishing-invoice",
      label: "Phishing lure disguised as invoice",
      email: {
        subject: "Urgent invoice requires payment",
        body: "Please process the wire transfer today and send the beneficiary details back immediately.",
        senderEmail: "ceo-payments@fakevendor.example",
        senderDomain: "fakevendor.example",
        extracted: {
          deadlines: ["today"],
          moneyMentions: ["$12,840"],
          urls: ["https://fakevendor.example/pay"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "scam_invoice_fraud",
        categoryScores: buildCategoryScores("scam_invoice_fraud", 92, [
          { category: "finance_payment", score: 60 },
          { category: "security_phishing", score: 54 },
        ]),
        riskTags: ["Invoice Scam", "Payment", "Impersonation"],
        signals: ["wire transfer signal detected", "beneficiary signal detected"],
        trustScore: 18,
        reputationScore: 26,
        decisionImportance: {
          threatScore: 92,
          urgencyScore: 34,
          relevanceScore: 20,
          opportunityScore: 0,
          noiseScore: 12,
          trustGapScore: 76,
          affinityScore: 4,
          attentionType: "verify_now",
          rationale: "dangerous but containment should reduce user burden",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 88,
        priorityBand: "high",
        trustedAction: "quarantine",
        confidencePct: 94,
        riskScore: 92,
        uncertaintyPercent: 18,
        threatType: "payment_fraud",
        mailClass: "harmful",
        classifier: {
          harmful: 0.92,
          actionable: 0.04,
          informational: 0.01,
          spam: 0.03,
        },
      },
      expected: {
        attentionPositive: false,
        harmful: true,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: false,
        expectedEventTypes: ["phishing_or_impersonation", "receipt_invoice"],
      },
    },
    {
      id: "fake-password-reset",
      label: "Fake password reset",
      email: {
        subject: "Reset your password now",
        body: "We detected unusual activity. Verify your account immediately using the secure link below.",
        senderEmail: "security@provider-alerts.example",
        senderDomain: "provider-alerts.example",
        extracted: {
          deadlines: ["immediately"],
          moneyMentions: [],
          urls: ["https://provider-alerts.example/reset"],
          attachments: [],
          attachmentRiskScore: 0,
        },
      },
      scoring: {
        primaryCategory: "scam_credential_phishing",
        categoryScores: buildCategoryScores("scam_credential_phishing", 90, [
          { category: "security_phishing", score: 66 },
        ]),
        riskTags: ["Credential Phishing", "Security"],
        signals: ["verify account signal detected"],
        trustScore: 24,
        reputationScore: 30,
        decisionImportance: {
          threatScore: 88,
          urgencyScore: 42,
          relevanceScore: 24,
          opportunityScore: 0,
          noiseScore: 10,
          trustGapScore: 72,
          affinityScore: 4,
          attentionType: "verify_now",
          rationale: "dangerous password-reset lookalike",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 82,
        priorityBand: "high",
        trustedAction: "quarantine",
        confidencePct: 90,
        riskScore: 90,
        uncertaintyPercent: 20,
        threatType: "phishing",
        mailClass: "harmful",
        classifier: {
          harmful: 0.9,
          actionable: 0.04,
          informational: 0.02,
          spam: 0.04,
        },
      },
      expected: {
        attentionPositive: false,
        harmful: true,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: false,
        expectedEventTypes: ["phishing_or_impersonation", "password_reset"],
      },
    },
    {
      id: "fake-order-confirmation",
      label: "Fake order confirmation",
      email: {
        subject: "Order confirmation attached",
        body: "Your order has been confirmed. Review the attached invoice and update your account details if anything looks wrong.",
        senderEmail: "orders@marketplace-alerts.example",
        senderDomain: "marketplace-alerts.example",
        extracted: {
          deadlines: [],
          moneyMentions: ["$499.99"],
          urls: ["https://marketplace-alerts.example/review"],
          attachments: ["invoice.html"],
          attachmentRiskScore: 38,
        },
      },
      scoring: {
        primaryCategory: "scam_invoice_fraud",
        categoryScores: buildCategoryScores("scam_invoice_fraud", 84, [
          { category: "finance_payment", score: 58 },
        ]),
        riskTags: ["Invoice Scam", "Payment", "Suspicious Attachment"],
        signals: ["invoice lure detected"],
        trustScore: 28,
        reputationScore: 34,
        decisionImportance: {
          threatScore: 84,
          urgencyScore: 28,
          relevanceScore: 20,
          opportunityScore: 0,
          noiseScore: 12,
          trustGapScore: 66,
          affinityScore: 6,
          attentionType: "verify_now",
          rationale: "dangerous fake commerce confirmation",
        },
        promotional: {
          lowRiskPromotional: false,
          promotionalConfidence: 0,
          promoUrgencyHits: 0,
          senderPromoHints: 0,
        },
      },
      legacy: {
        priorityScore: 78,
        priorityBand: "medium",
        trustedAction: "quarantine",
        confidencePct: 88,
        riskScore: 86,
        uncertaintyPercent: 24,
        threatType: "payment_fraud",
        mailClass: "harmful",
        classifier: {
          harmful: 0.86,
          actionable: 0.06,
          informational: 0.03,
          spam: 0.05,
        },
      },
      expected: {
        attentionPositive: false,
        harmful: true,
        transactionalEvent: false,
        authEvent: false,
        jobUpdate: false,
        promoNoise: false,
        importantBenign: false,
        expectedEventTypes: ["phishing_or_impersonation", "purchase_confirmed", "receipt_invoice"],
      },
    },
  ];
}

/**
 * Runs the default benchmark fixture set.
 */
export function runDecisionModelBenchmark(): {
  results: DecisionBenchmarkResult[];
  metrics: DecisionBenchmarkMetrics;
} {
  const fixtures = buildDecisionBenchmarkFixtures();
  const results = fixtures.map(runDecisionBenchmarkFixture);
  return {
    results,
    metrics: computeDecisionBenchmarkMetrics(results),
  };
}
