export type InboxMailClassLike = "spam" | "harmful" | "actionable" | "informational";
export type TrustedDecisionActionLike = "allow" | "escalate" | "quarantine" | "block";

export type InboxAttentionType =
  | "act_now"
  | "verify_now"
  | "review_later"
  | "ignore_routine";

export type DecisionImportanceHint = {
  mailClass: InboxMailClassLike;
  trustedAction: TrustedDecisionActionLike;
  priorityScore: number;
  outcomeLabel: string;
};

export type DecisionImportanceProfile = {
  threatScore: number;
  urgencyScore: number;
  relevanceScore: number;
  opportunityScore: number;
  noiseScore: number;
  trustGapScore: number;
  affinityScore: number;
  attentionType: InboxAttentionType;
  rationale: string;
};

type DecisionImportanceCategory = {
  category: string;
  score: number;
};

type DecisionImportanceArgs = {
  primaryCategory: string;
  categoryScores: DecisionImportanceCategory[];
  trustScore: number;
  reputationScore: number;
  thread: {
    depth: number;
    riskDensity: number;
  };
  externalSender: boolean;
  suspiciousDomain: boolean;
  attachmentRiskScore: number;
  urlsCount: number;
  deadlineCount: number;
  moneyMentionsCount: number;
  signalCount: number;
  hitCounts: {
    deadline: number;
    scheduling: number;
    executive: number;
    support: number;
  };
  text: string;
  incidentHints: DecisionImportanceHint[];
};

const OPPORTUNITY_PATTERNS = [
  /\bexclusive\b/i,
  /\bmember[- ]only\b/i,
  /\bpromo code\b/i,
  /\bcoupon\b/i,
  /\bpercent off\b/i,
  /\b\d{1,3}% off\b/i,
  /\bbogo\b/i,
  /\bbuy one get one\b/i,
  /\blimited time\b/i,
  /\bflash sale\b/i,
  /\bspecial offer\b/i,
];

const CAREER_PATTERNS = [
  /\binterview\b/i,
  /\brecruiter\b/i,
  /\bapplication\b/i,
  /\bapplying\b/i,
  /\bposition\b/i,
  /\brole\b/i,
  /\bintern(ship)?\b/i,
  /\bhiring\b/i,
  /\bcandidate\b/i,
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreOfCategory(categoryScores: DecisionImportanceCategory[], category: string): number {
  return categoryScores.find((entry) => entry.category === category)?.score ?? 0;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function buildAffinityScore(hints: DecisionImportanceHint[]): number {
  const learnedHints = hints.filter((hint) => Boolean(hint.outcomeLabel));
  if (learnedHints.length === 0) return 0;

  const positive = learnedHints.filter(
    (hint) =>
      hint.outcomeLabel === "spam_false_positive" ||
      hint.outcomeLabel === "actionable_correct" ||
      hint.outcomeLabel === "informational_correct"
  ).length;

  const negative = learnedHints.filter(
    (hint) =>
      hint.outcomeLabel === "harmful_true_positive" ||
      hint.outcomeLabel === "spam_true_positive"
  ).length;

  const memoryDepthBonus =
    learnedHints.length >= 3 ? 10 : learnedHints.length === 2 ? 6 : 2;
  return clamp(
    Math.round(
      (positive / learnedHints.length) * 75 -
        (negative / learnedHints.length) * 45 +
        memoryDepthBonus
    ),
    0,
    100
  );
}

function attentionTypeFromScores(args: {
  threatScore: number;
  urgencyScore: number;
  relevanceScore: number;
  opportunityScore: number;
  noiseScore: number;
  trustGapScore: number;
}): InboxAttentionType {
  if (args.threatScore >= 72 && args.trustGapScore >= 55) {
    return "verify_now";
  }
  if (args.urgencyScore >= 62 && args.relevanceScore >= 50) {
    return "act_now";
  }
  if (
    args.noiseScore >= 62 &&
    args.threatScore < 50 &&
    args.urgencyScore < 45 &&
    args.opportunityScore < 60 &&
    args.relevanceScore < 32
  ) {
    return "ignore_routine";
  }
  if (args.opportunityScore >= 62 || args.relevanceScore >= 58) {
    return "review_later";
  }
  return "review_later";
}

export function buildDecisionImportanceProfile(
  args: DecisionImportanceArgs
): DecisionImportanceProfile {
  const scamPeak = Math.max(
    scoreOfCategory(args.categoryScores, "scam_bec"),
    scoreOfCategory(args.categoryScores, "scam_invoice_fraud"),
    scoreOfCategory(args.categoryScores, "scam_credential_phishing"),
    scoreOfCategory(args.categoryScores, "scam_malware_attachment"),
    scoreOfCategory(args.categoryScores, "scam_impersonation")
  );
  const securityScore = scoreOfCategory(args.categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(args.categoryScores, "finance_payment");
  const legalScore = scoreOfCategory(args.categoryScores, "legal_contract");
  const deadlineScore = scoreOfCategory(args.categoryScores, "deadline_scheduling");
  const executiveScore = scoreOfCategory(args.categoryScores, "executive_escalation");
  const salesScore = scoreOfCategory(args.categoryScores, "sales_marketing");
  const supportScore = scoreOfCategory(args.categoryScores, "ops_support");
  const newsletterScore = scoreOfCategory(args.categoryScores, "newsletter");

  const opportunityHits = countMatches(args.text, OPPORTUNITY_PATTERNS);
  const careerHits = countMatches(args.text, CAREER_PATTERNS);
  const affinityScore = buildAffinityScore(args.incidentHints);

  const trustGapScore = clamp(
    Math.round(
      (100 - args.trustScore) * 0.55 +
        (100 - args.reputationScore) * 0.32 +
        (args.externalSender ? 10 : 0) +
        (args.suspiciousDomain ? 16 : 0) +
        Math.min(14, args.urlsCount * 2) +
        (args.attachmentRiskScore >= 35 ? 10 : 0)
    ),
    0,
    100
  );

  const threatScore = clamp(
    Math.round(
      scamPeak * 0.58 +
        securityScore * 0.52 +
        financeScore * 0.42 +
        args.attachmentRiskScore * 0.18 +
        args.urlsCount * 2 +
        trustGapScore * 0.22 -
        affinityScore * 0.15
    ),
    0,
    100
  );

  const urgencyScore = clamp(
    Math.round(
      deadlineScore * 0.62 +
        legalScore * 0.28 +
        financeScore * 0.18 +
        executiveScore * 0.16 +
        supportScore * 0.12 +
        args.deadlineCount * 8 +
        args.hitCounts.deadline * 5 +
        args.hitCounts.scheduling * 3 +
        careerHits * 7 +
        (args.thread.depth >= 2 ? 6 : 0)
    ),
    0,
    100
  );

  const relevanceScore = clamp(
    Math.round(
      6 +
        affinityScore * 0.42 +
        args.trustScore * 0.12 +
        args.reputationScore * 0.05 +
        args.thread.depth * 6 +
        careerHits * 11 +
        (args.primaryCategory === "deadline_scheduling" ||
        args.primaryCategory === "legal_contract" ||
        args.primaryCategory === "ops_support" ||
        args.primaryCategory === "finance_payment" ||
        args.primaryCategory === "executive_escalation"
          ? 14
          : 0) +
        (args.primaryCategory === "sales_marketing" ? 8 : 0) +
        (args.externalSender ? 0 : 10) -
        newsletterScore * 0.34 -
        salesScore * 0.18
    ),
    0,
    100
  );

  const opportunityScore = clamp(
    Math.round(
      salesScore * 0.32 +
        newsletterScore * 0.08 +
        opportunityHits * 5 +
        affinityScore * 0.62 +
        careerHits * 6 -
        threatScore * 0.12 -
        trustGapScore * 0.12
    ),
    0,
    100
  );

  const nonPreferredPromotional =
    (salesScore >= 35 || newsletterScore >= 28) &&
    affinityScore < 35 &&
    careerHits === 0;
  const calibratedOpportunityScore = nonPreferredPromotional
    ? Math.min(opportunityScore, 48)
    : opportunityScore;

  const noiseScore = clamp(
    Math.round(
      newsletterScore * 0.78 +
        salesScore * 0.42 +
        (args.signalCount <= 2 ? 12 : 0) +
        (args.deadlineCount === 0 ? 6 : 0) +
        (careerHits === 0 ? 4 : 0) -
        calibratedOpportunityScore * 0.34 -
        relevanceScore * 0.22 -
        urgencyScore * 0.26 -
        threatScore * 0.18 +
        (nonPreferredPromotional ? 12 : 0)
    ),
    0,
    100
  );

  const attentionType = attentionTypeFromScores({
    threatScore,
    urgencyScore,
    relevanceScore,
    opportunityScore: calibratedOpportunityScore,
    noiseScore,
    trustGapScore,
  });

  let rationale = "Balanced review recommended.";
  if (attentionType === "verify_now") {
    rationale = "Potentially important message, but sender trust or identity confidence is weak.";
  } else if (attentionType === "act_now") {
    rationale = "Time-sensitive message with meaningful consequence if ignored.";
  } else if (attentionType === "review_later") {
    rationale = "Relevant or useful message, but not urgent enough to interrupt the queue.";
  } else if (attentionType === "ignore_routine") {
    rationale = "Promotional or routine noise signals outweigh any likely action value.";
  }

  return {
    threatScore,
    urgencyScore,
    relevanceScore,
    opportunityScore: calibratedOpportunityScore,
    noiseScore,
    trustGapScore,
    affinityScore,
    attentionType,
    rationale,
  };
}
