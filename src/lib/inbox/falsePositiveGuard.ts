export type FalsePositiveGuardInput = {
  rawPriorityScore: number;
  priorityBand: "high" | "medium" | "low";
  primaryCategory: string;
  categoryScores: Record<string, number>;
  riskTags: string[];
  signals: string[];
  decisionProfile: {
    threat: number;
    urgency: number;
    relevance: number;
    opportunity: number;
    noise: number;
    trustGap: number;
    affinity: number;
    attentionType: string;
  };
  email: {
    receivedAt: Date | null;
    senderEmail: string;
    senderDomain: string;
    deadlines: string[];
    moneyMentions: string[];
    attachmentRiskScore: number;
    urlCount: number;
    threadDepth: number;
    body: string;
  };
  trust: {
    senderScore: number;
    domainScore: number;
    seen: number;
    highCount: number;
    mediumCount: number;
    lastSeen: Date | null;
  };
  history: {
    outcomeLabels: string[];
    priorPriorityScores: number[];
    memorySampleCount: number;
  };
  promotional: {
    lowRiskPromotional: boolean;
    promotionalConfidence: number;
    promoUrgencyHits: number;
    senderPromoHints: number;
  };
  classifier: {
    spamProbability: number;
    harmfulProbability: number;
    actionableProbability: number;
    informationalProbability: number;
  };
};

export type FalsePositiveGuardResult = {
  correctedScore: number;
  correctedBand: "high" | "medium" | "low";
  guardActivated: boolean;
  corrections: Array<{
    rule: string;
    delta: number;
    reason: string;
  }>;
  confidenceAdjustment: number;
};

type FalsePositiveCorrection = FalsePositiveGuardResult["corrections"][number];

type GuardState = {
  score: number;
  corrections: FalsePositiveCorrection[];
  confidenceAdjustment: number;
  forceLowBand: boolean;
};

type RuleEffect = {
  corrections: FalsePositiveCorrection[];
  confidenceAdjustment?: number;
  forceLowBand?: boolean;
};

const PROTECTED_RISK_TAGS = new Set([
  "BEC Scam",
  "Credential Phishing",
  "Malware Risk",
  "Impersonation",
]);

const SENSITIVE_BULK_RISK_TAGS = new Set([
  "BEC Scam",
  "Payment",
  "Legal",
  "Credential Phishing",
  "Malware Risk",
  "Impersonation",
]);

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Clamps a numeric value into a safe score or uncertainty range.
 *
 * Pipeline step: shared utility for the post-scoring false-positive correction layer.
 * False-positive scenario addressed: prevents stacked penalties from pushing score or uncertainty outside valid bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts a numeric priority score back into the inbox priority band.
 *
 * Pipeline step: final derivation step after post-scoring false-positive corrections are applied.
 * False-positive scenario addressed: ensures reductions correctly demote medium/high false positives into lower bands.
 */
function bandFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/**
 * Returns true when the scanner is already in a threat-sensitive mode that should bypass suppression.
 *
 * Pipeline step: global gate before rule evaluation in the post-scoring correction layer.
 * False-positive scenario addressed: avoids suppressing genuine high-threat verify-now messages.
 */
function shouldBypassGuard(input: FalsePositiveGuardInput): boolean {
  return (
    input.decisionProfile.attentionType === "verify_now" ||
    input.decisionProfile.threat >= 82
  );
}

/**
 * Builds a local end-of-day timestamp for a given anchor date.
 *
 * Pipeline step: deadline resolution helper used by stale urgency decay.
 * False-positive scenario addressed: correctly expires "today", "tonight", and "end of day" language once the day has passed.
 */
function endOfDay(anchor: Date): Date {
  const out = new Date(anchor);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Advances a date by a whole-number day offset while preserving local time semantics.
 *
 * Pipeline step: relative deadline resolution helper used by stale urgency decay.
 * False-positive scenario addressed: resolves "tomorrow" and "within N days/weeks" accurately from message receipt time.
 */
function addDays(anchor: Date, days: number): Date {
  const out = new Date(anchor);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Resolves a weekday phrase like "by Friday" or "next Tuesday" relative to the received timestamp.
 *
 * Pipeline step: deadline phrase parsing for stale urgency decay.
 * False-positive scenario addressed: catches stale weekday-based urgency that would otherwise continue inflating priority.
 */
function resolveWeekdayPhrase(
  phrase: string,
  anchor: Date
): Date | null {
  const match = phrase
    .toLowerCase()
    .match(/\b(?:by|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!match) return null;

  const target = WEEKDAY_INDEX[match[1]];
  const current = anchor.getDay();
  let delta = (target - current + 7) % 7;

  if (phrase.toLowerCase().includes("next ")) {
    delta = delta === 0 ? 7 : delta + 7;
  } else if (delta === 0 && phrase.toLowerCase().startsWith("by ")) {
    delta = 0;
  }

  return endOfDay(addDays(anchor, delta));
}

/**
 * Resolves a raw extracted deadline phrase into an absolute timestamp.
 *
 * Pipeline step: deadline normalization before stale urgency decay is evaluated.
 * False-positive scenario addressed: turns relative phrases into concrete time bounds so expired urgency can be discounted.
 */
function resolveDeadlinePhrase(
  phrase: string,
  receivedAt: Date | null
): Date | null {
  const anchor = receivedAt ? new Date(receivedAt) : new Date();
  const lower = phrase.trim().toLowerCase();

  const weekdayDeadline = resolveWeekdayPhrase(lower, anchor);
  if (weekdayDeadline) return weekdayDeadline;

  if (/\b(end of day|eod|today|tonight)\b/i.test(lower)) {
    return endOfDay(anchor);
  }

  if (/\btomorrow\b/i.test(lower)) {
    return endOfDay(addDays(anchor, 1));
  }

  if (/\bend of week\b/i.test(lower)) {
    const delta = (5 - anchor.getDay() + 7) % 7;
    return endOfDay(addDays(anchor, delta));
  }

  const relative = lower.match(/\bwithin\s+(\d+)\s+(hour|hours|day|days|week|weeks)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    if (Number.isFinite(amount) && amount > 0) {
      const unit = relative[2].toLowerCase();
      const out = new Date(anchor);
      if (unit.startsWith("hour")) {
        out.setHours(out.getHours() + amount);
      } else if (unit.startsWith("day")) {
        out.setDate(out.getDate() + amount);
      } else {
        out.setDate(out.getDate() + amount * 7);
      }
      return out;
    }
  }

  const parsed = new Date(phrase);
  if (Number.isFinite(parsed.getTime())) {
    if (!/\d{1,2}:\d{2}/.test(phrase)) {
      parsed.setHours(23, 59, 59, 999);
    }
    return parsed;
  }

  return null;
}

/**
 * Counts how many extracted deadlines have already passed as of now.
 *
 * Pipeline step: stale urgency analysis in the post-scoring correction layer.
 * False-positive scenario addressed: prevents expired urgency language from keeping old mail in medium/high priority.
 */
function countStaleDeadlines(input: FalsePositiveGuardInput): {
  staleDateCount: number;
  resolvableCount: number;
} {
  let staleDateCount = 0;
  let resolvableCount = 0;
  const now = Date.now();

  for (const phrase of input.email.deadlines) {
    const resolved = resolveDeadlinePhrase(phrase, input.email.receivedAt);
    if (!resolved) continue;
    resolvableCount += 1;
    if (resolved.getTime() < now) {
      staleDateCount += 1;
    }
  }

  return { staleDateCount, resolvableCount };
}

/**
 * Applies stale urgency decay when deadline language points to a moment that has already passed.
 *
 * Pipeline step: first post-scoring suppression rule after priority guardrails and before trusted-action construction.
 * False-positive scenario addressed: FP-1 stale urgency that keeps expired deadline mail artificially elevated.
 */
function applyStaleUrgencyDecay(
  input: FalsePositiveGuardInput
): RuleEffect {
  if (
    input.email.deadlines.length === 0 ||
    input.decisionProfile.urgency < 40 ||
    input.decisionProfile.threat >= 72
  ) {
    return { corrections: [] };
  }

  const { staleDateCount, resolvableCount } = countStaleDeadlines(input);
  if (staleDateCount === 0) {
    return { corrections: [] };
  }

  const urgencyPenalty = Math.round(
    Math.min(28, staleDateCount * 11) * (input.decisionProfile.urgency / 100)
  );
  const corrections: FalsePositiveCorrection[] = [];

  if (urgencyPenalty > 0) {
    corrections.push({
      rule: "stale_urgency_decay",
      delta: -urgencyPenalty,
      reason: `${staleDateCount} extracted deadline${staleDateCount === 1 ? "" : "s"} already passed, so urgency should decay instead of keeping the message elevated.`,
    });
  }

  if (
    resolvableCount > 0 &&
    staleDateCount === resolvableCount &&
    input.decisionProfile.threat < 55
  ) {
    corrections.push({
      rule: "stale_urgency_decay_full",
      delta: -8,
      reason: "All extracted deadlines are stale and the message does not carry enough threat to justify keeping urgency at full strength.",
    });
  }

  return {
    corrections,
    confidenceAdjustment: corrections.length > 1 ? 4 : 2,
  };
}

/**
 * Discounts trust inflation for senders that are frequently surfaced but rarely actioned by the user.
 *
 * Pipeline step: post-scoring sender-trust correction before trusted-action construction.
 * False-positive scenario addressed: FP-2 habitual-open senders that inherit too much trust despite low genuine engagement.
 */
function applyHabitOpenSenderDiscount(
  input: FalsePositiveGuardInput
): RuleEffect {
  const openRate =
    input.trust.seen > 0 ? input.trust.highCount / input.trust.seen : 0;
  const replyRate =
    input.trust.seen > 0
      ? (input.trust.seen - input.trust.highCount - input.trust.mediumCount) /
        input.trust.seen
      : 0;
  const hasProtectedRisk = input.riskTags.some((tag) => PROTECTED_RISK_TAGS.has(tag));

  if (
    input.trust.seen < 6 ||
    openRate < 0.55 ||
    replyRate > 0.12 ||
    input.trust.senderScore < 58 ||
    input.decisionProfile.affinity >= 35 ||
    input.promotional.lowRiskPromotional ||
    input.email.attachmentRiskScore >= 30 ||
    input.decisionProfile.threat >= 60 ||
    hasProtectedRisk
  ) {
    return { corrections: [] };
  }

  const habitInflation = input.trust.senderScore - 45;
  const penalty = Math.round(Math.min(18, habitInflation * 0.55));
  if (penalty <= 0) {
    return { corrections: [] };
  }

  return {
    corrections: [
      {
        rule: "habit_open_sender_discount",
        delta: -penalty,
        reason: "Sender trust appears inflated by repeated low-engagement opens rather than by messages the user actually acts on.",
      },
    ],
    confidenceAdjustment: 4,
  };
}

/**
 * Suppresses deep threads that have likely become dormant rather than still requiring active attention.
 *
 * Pipeline step: post-scoring thread relevance correction before trusted-action construction.
 * False-positive scenario addressed: FP-3 thread fatigue where depth is mistakenly treated as continuing relevance.
 */
function applyThreadFatigueSuppression(
  input: FalsePositiveGuardInput
): RuleEffect {
  const recentOutcomes = input.history.outcomeLabels.slice(0, 3);
  const recentlyActionable = recentOutcomes.includes("actionable_correct");

  if (
    input.email.threadDepth < 7 ||
    input.decisionProfile.relevance >= 62 ||
    input.decisionProfile.threat >= 58 ||
    recentlyActionable ||
    input.classifier.actionableProbability >= 0.48
  ) {
    return { corrections: [] };
  }

  const fatigueDepth = input.email.threadDepth - 6;
  const corrections: FalsePositiveCorrection[] = [];
  const penalty = Math.round(Math.min(16, fatigueDepth * 3.2));

  if (penalty > 0) {
    corrections.push({
      rule: "thread_fatigue_suppression",
      delta: -penalty,
      reason: "This thread is deep, but recent behavior suggests the user stopped engaging rather than continuing the conversation.",
    });
  }

  if (
    input.decisionProfile.urgency < 45 &&
    input.promotional.promotionalConfidence >= 1.2
  ) {
    corrections.push({
      rule: "thread_fatigue_promo_boost",
      delta: -6,
      reason: "Promotional language inside a fatigued thread should not revive the conversation into a higher-priority item.",
    });
  }

  return {
    corrections,
    confidenceAdjustment: corrections.length > 1 ? 5 : 3,
  };
}

/**
 * Catches broadcast-style bulk mail from trusted senders when sender familiarity leaks through promotional suppression.
 *
 * Pipeline step: post-scoring promotional correction before trusted-action construction.
 * False-positive scenario addressed: FP-4 trusted bulk bleed-through from known senders that occasionally send announcements or newsletters.
 */
function applyTrustedBulkBleedCorrection(
  input: FalsePositiveGuardInput
): RuleEffect {
  const hasSensitiveRisk = input.riskTags.some((tag) =>
    SENSITIVE_BULK_RISK_TAGS.has(tag)
  );

  if (
    input.trust.senderScore < 65 ||
    input.promotional.senderPromoHints < 2 ||
    input.promotional.promoUrgencyHits < 1 ||
    input.classifier.spamProbability < 0.28 ||
    input.decisionProfile.opportunity >= 55 ||
    input.email.moneyMentions.length > 0 ||
    input.email.attachmentRiskScore >= 20 ||
    input.decisionProfile.threat >= 55 ||
    hasSensitiveRisk ||
    (input.email.deadlines.length >= 2 && input.decisionProfile.urgency >= 55)
  ) {
    return { corrections: [] };
  }

  const penalty = 14 + Math.min(10, input.promotional.senderPromoHints * 3);
  return {
    corrections: [
      {
        rule: "trusted_bulk_bleed_correction",
        delta: -penalty,
        reason: "Trusted sender identity is being treated as stronger evidence than the bulk promotional pattern actually warrants.",
      },
    ],
    confidenceAdjustment: 4,
  };
}

/**
 * Floors confidence when one isolated category hit is carrying a message without corroborating evidence.
 *
 * Pipeline step: post-scoring corroboration check before trusted-action construction.
 * False-positive scenario addressed: FP-5 single-signal inflation where one keyword pushes mail into medium/high priority alone.
 */
function applySingleSignalConfidenceFloor(
  input: FalsePositiveGuardInput
): RuleEffect {
  const categoryValues = Object.values(input.categoryScores);
  const categoryHitCount = categoryValues.filter((score) => score >= 12).length;
  const isolatedScore = Math.max(0, ...categoryValues);

  if (
    categoryHitCount !== 1 ||
    input.email.deadlines.length > 0 ||
    input.email.moneyMentions.length > 0 ||
    input.email.attachmentRiskScore >= 15 ||
    input.email.urlCount > 2 ||
    input.decisionProfile.trustGap >= 40 ||
    input.rawPriorityScore < 50 ||
    input.primaryCategory.startsWith("scam_") ||
    input.decisionProfile.threat >= 65
  ) {
    return { corrections: [] };
  }

  const penalty = Math.round(Math.min(22, Math.max(0, isolatedScore - 12) * 0.9));
  if (penalty <= 0) {
    return { corrections: [] };
  }

  return {
    corrections: [
      {
        rule: "single_signal_confidence_floor",
        delta: -penalty,
        reason: "The score is being driven by one isolated category hit without enough corroborating evidence elsewhere in the message.",
      },
    ],
    confidenceAdjustment: 8,
  };
}

/**
 * Accelerates suppression for senders with repeated low-value feedback history even when recency keeps trust partially elevated.
 *
 * Pipeline step: post-scoring memory correction before trusted-action construction.
 * False-positive scenario addressed: FP-6 recurring low-value senders whose trust does not decay quickly enough after repeated negative outcomes.
 */
function applyFeedbackMemoryDecayCorrection(
  input: FalsePositiveGuardInput,
  currentScore: number
): RuleEffect {
  const hasProtectedRisk = input.riskTags.some((tag) => PROTECTED_RISK_TAGS.has(tag));
  if (
    input.decisionProfile.threat >= 65 ||
    hasProtectedRisk
  ) {
    return { corrections: [] };
  }

  const negativeOutcomes = input.history.outcomeLabels.filter(
    (label) => label === "spam_true_positive"
  ).length;
  const positiveOutcomes = input.history.outcomeLabels.filter(
    (label) =>
      label === "actionable_correct" ||
      label === "informational_correct" ||
      label === "spam_false_positive" ||
      label === "harmful_false_positive"
  ).length;

  if (
    negativeOutcomes < 2 ||
    negativeOutcomes <= positiveOutcomes ||
    input.history.memorySampleCount < 3 ||
    input.rawPriorityScore < 46 ||
    input.decisionProfile.threat >= 60
  ) {
    return { corrections: [] };
  }

  const decayRatio =
    negativeOutcomes / Math.max(1, input.history.memorySampleCount);
  const corrections: FalsePositiveCorrection[] = [];
  const penalty = Math.round(Math.min(24, decayRatio * 32));

  if (penalty > 0) {
    corrections.push({
      rule: "feedback_memory_decay_correction",
      delta: -penalty,
      reason: "Stored feedback trends show this sender behaves like recurring low-value mail more often than like something the user wants surfaced.",
    });
  }

  let forceLowBand = false;
  if (negativeOutcomes >= 4 && positiveOutcomes === 0 && currentScore >= 50) {
    const hardSuppressDelta = 49 - (currentScore + corrections.reduce((sum, entry) => sum + entry.delta, 0));
    if (hardSuppressDelta < 0) {
      corrections.push({
        rule: "feedback_memory_hard_suppress",
        delta: hardSuppressDelta,
        reason: "Repeated negative feedback with no positive outcomes justifies forcing this sender back into the low-priority band.",
      });
    }
    forceLowBand = true;
  }

  return {
    corrections,
    confidenceAdjustment: -5,
    forceLowBand,
  };
}

/**
 * Applies a single rule effect onto the evolving guard state.
 *
 * Pipeline step: state reducer for the post-scoring false-positive correction layer.
 * False-positive scenario addressed: ensures multiple suppression rules can stack cleanly without producing invalid upward adjustments.
 */
function applyRuleEffect(
  state: GuardState,
  effect: RuleEffect,
  maxScore: number
): GuardState {
  let score = state.score;
  const corrections = [...state.corrections];

  for (const correction of effect.corrections) {
    const requestedDelta = Math.min(0, Math.round(correction.delta));
    if (requestedDelta === 0 && correction.rule !== "feedback_memory_hard_suppress") {
      continue;
    }
    const nextScore = clamp(score + requestedDelta, 0, maxScore);
    const appliedDelta = nextScore - score;
    score = nextScore;
    if (appliedDelta === 0 && correction.rule !== "feedback_memory_hard_suppress") {
      continue;
    }
    corrections.push({
      ...correction,
      delta: appliedDelta,
    });
  }

  return {
    score,
    corrections,
    confidenceAdjustment: state.confidenceAdjustment + (effect.confidenceAdjustment ?? 0),
    forceLowBand: state.forceLowBand || Boolean(effect.forceLowBand),
  };
}

/**
 * Applies the stacked false-positive correction rules after priority guardrails and before trusted action construction.
 *
 * Pipeline step: post-scoring confidence correction layer between priority guardrails and trusted decision building.
 * False-positive scenario addressed: reduces stale urgency, habitual-open trust inflation, thread fatigue, trusted bulk bleed-through, isolated single-signal inflation, and slow memory decay.
 */
export function applyFalsePositiveGuard(
  input: FalsePositiveGuardInput
): FalsePositiveGuardResult {
  const rawPriorityScore = clamp(Math.round(input.rawPriorityScore), 0, 100);
  const initialState: GuardState = {
    score: rawPriorityScore,
    corrections: [],
    confidenceAdjustment: 0,
    forceLowBand: false,
  };

  if (shouldBypassGuard(input)) {
    return {
      correctedScore: rawPriorityScore,
      correctedBand: input.priorityBand,
      guardActivated: false,
      corrections: [],
      confidenceAdjustment: 0,
    };
  }

  const afterStaleUrgency = applyRuleEffect(
    initialState,
    applyStaleUrgencyDecay(input),
    rawPriorityScore
  );
  const afterHabitOpen = applyRuleEffect(
    afterStaleUrgency,
    applyHabitOpenSenderDiscount(input),
    rawPriorityScore
  );
  const afterThreadFatigue = applyRuleEffect(
    afterHabitOpen,
    applyThreadFatigueSuppression(input),
    rawPriorityScore
  );
  const afterBulkBleed = applyRuleEffect(
    afterThreadFatigue,
    applyTrustedBulkBleedCorrection(input),
    rawPriorityScore
  );
  const afterSingleSignal = applyRuleEffect(
    afterBulkBleed,
    applySingleSignalConfidenceFloor(input),
    rawPriorityScore
  );
  const finalState = applyRuleEffect(
    afterSingleSignal,
    applyFeedbackMemoryDecayCorrection(input, afterSingleSignal.score),
    rawPriorityScore
  );

  const correctedScore = clamp(
    Math.min(rawPriorityScore, finalState.score),
    0,
    100
  );
  const correctedBand = finalState.forceLowBand
    ? "low"
    : bandFromScore(correctedScore);

  return {
    correctedScore,
    correctedBand,
    guardActivated: finalState.corrections.length > 0,
    corrections: finalState.corrections,
    confidenceAdjustment: clamp(
      Math.round(finalState.confidenceAdjustment),
      -15,
      20
    ),
  };
}
