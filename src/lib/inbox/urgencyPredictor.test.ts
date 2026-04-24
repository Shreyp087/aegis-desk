import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { hashSubjectPattern } from "./sessionStore";
import { predictUrgency } from "./urgencyPredictor";

function storedSubjectHash(subject: string): string {
  return createHash("sha256")
    .update(`subject:${subject}`)
    .digest("hex")
    .slice(0, 20);
}

test("novel exact subject from an established sender boosts urgency", () => {
  const result = predictUrgency({
    email: {
      receivedAt: new Date("2026-04-23T14:00:00.000Z"),
      senderEmail: "ops@example.com",
      senderDomain: "example.com",
      subject: "Updated payment approval chain",
      deadlines: [],
      body: "",
    },
    trust: {
      senderScore: 78,
      seen: 6,
      lastSeen: new Date("2026-04-22T14:00:00.000Z"),
    },
    history: {
      subjectHashes: [storedSubjectHash("Weekly operations update")],
      priorPriorityScores: [42],
      outcomeLabels: ["informational"],
      avgResponseGapHours: null,
      lastEmailFromSender: null,
    },
    currentDecisionProfile: {
      urgency: 38,
      relevance: 44,
      threat: 16,
    },
  });

  assert.ok(
    result.predictionFactors.some(
      (factor) =>
        factor.factor === "P4_subject_trajectory" &&
        factor.direction === "boost" &&
        factor.magnitude === 11
    )
  );
  assert.ok(result.urgencyDelta > 0);
});

test("recurring low-value exact subject suppresses urgency", () => {
  const result = predictUrgency({
    email: {
      receivedAt: new Date("2026-04-23T14:00:00.000Z"),
      senderEmail: "digest@example.com",
      senderDomain: "example.com",
      subject: "Weekly roundup",
      deadlines: [],
      body: "",
    },
    trust: {
      senderScore: 88,
      seen: 8,
      lastSeen: new Date("2026-04-22T14:00:00.000Z"),
    },
    history: {
      subjectHashes: [
        storedSubjectHash("Weekly roundup"),
        storedSubjectHash("Weekly roundup"),
      ],
      priorPriorityScores: [18, 24],
      outcomeLabels: ["informational", "spam_true_positive"],
      avgResponseGapHours: 48,
      lastEmailFromSender: new Date("2026-04-22T14:00:00.000Z"),
    },
    currentDecisionProfile: {
      urgency: 42,
      relevance: 18,
      threat: 8,
    },
  });

  assert.ok(
    result.predictionFactors.some(
      (factor) =>
        factor.factor === "P4_subject_trajectory" &&
        factor.direction === "suppress"
    )
  );
  assert.ok(result.urgencyDelta < 0);
});

test("repeated hashed subject pattern inside the batch suppresses routine urgency inflation", () => {
  const subject = "Vendor sync reminder";
  const result = predictUrgency({
    email: {
      receivedAt: new Date("2026-04-23T14:00:00.000Z"),
      senderEmail: "vendor@example.com",
      senderDomain: "example.com",
      subject,
      deadlines: [],
      body: "",
    },
    trust: {
      senderScore: 72,
      seen: 5,
      lastSeen: new Date("2026-04-22T10:00:00.000Z"),
    },
    history: {
      subjectHashes: [storedSubjectHash(subject)],
      priorPriorityScores: [74],
      outcomeLabels: ["actionable_correct"],
      avgResponseGapHours: null,
      lastEmailFromSender: null,
    },
    batchContext: {
      currentSubjectPatternHash: hashSubjectPattern(subject),
      priorSenderSubjectPatternHashes: [
        hashSubjectPattern(subject),
        hashSubjectPattern(subject),
      ],
    },
    currentDecisionProfile: {
      urgency: 40,
      relevance: 36,
      threat: 12,
    },
  });

  assert.ok(
    result.predictionFactors.some(
      (factor) =>
        factor.factor === "P4_subject_trajectory" &&
        factor.direction === "suppress" &&
        factor.magnitude === 6
    )
  );
  assert.ok(result.urgencyDelta < 0);
});
