import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionStore,
  hashSignal,
  hashSubjectPattern,
  updateRecord,
} from "./sessionStore";
import { buildTemporalContext } from "./temporalContext";

type SessionEmailFixture = {
  senderDomain: string;
  threadKey: string;
  receivedAt: Date;
  primaryCategory: string;
  subject: string;
  body?: string;
  moneyMentions?: string[];
  deadlines?: string[];
};

function buildStore(emails: SessionEmailFixture[]) {
  return buildSessionStore(
    emails.map((email) => ({
      senderDomain: email.senderDomain,
      threadKey: email.threadKey,
      receivedAt: email.receivedAt,
      subjectPatternHash: hashSubjectPattern(email.subject),
      moneyMentions: email.moneyMentions ?? [],
      deadlines: email.deadlines ?? [],
      primaryCategory: email.primaryCategory,
      body: email.body ?? "",
    }))
  );
}

function findRecord(
  store: ReturnType<typeof buildStore>,
  email: SessionEmailFixture
) {
  const senderDomainHash = hashSignal(email.senderDomain);
  const threadKeyHash = hashSignal(email.threadKey);
  const receivedAt = email.receivedAt.getTime();
  const subjectPatternHash = hashSubjectPattern(email.subject);

  const record = store.allRecords.find(
    (candidate) =>
      candidate.senderDomainHash === senderDomainHash &&
      candidate.threadKeyHash === threadKeyHash &&
      candidate.receivedAt === receivedAt &&
      candidate.subjectPatternHash === subjectPatternHash
  );

  assert.ok(record, "expected session record to exist");
  return record;
}

test("sender reappears after unusual silence with a new hashed subject pattern", () => {
  const emails: SessionEmailFixture[] = [
    {
      senderDomain: "vendor.example",
      threadKey: "vendor-1",
      receivedAt: new Date("2026-04-23T09:00:00.000Z"),
      primaryCategory: "general",
      subject: "Daily operations update",
    },
    {
      senderDomain: "vendor.example",
      threadKey: "vendor-2",
      receivedAt: new Date("2026-04-23T10:00:00.000Z"),
      primaryCategory: "general",
      subject: "Daily operations update",
    },
    {
      senderDomain: "vendor.example",
      threadKey: "vendor-3",
      receivedAt: new Date("2026-04-23T11:00:00.000Z"),
      primaryCategory: "general",
      subject: "Daily operations update",
    },
    {
      senderDomain: "vendor.example",
      threadKey: "vendor-4",
      receivedAt: new Date("2026-04-23T20:00:00.000Z"),
      primaryCategory: "general",
      subject: "Urgent banking instructions",
    },
  ];

  const store = buildStore(emails);
  const currentRecord = findRecord(store, emails[3]);

  const result = buildTemporalContext({
    senderDomainHash: currentRecord.senderDomainHash,
    threadKeyHash: currentRecord.threadKeyHash,
    clusterKey: currentRecord.clusterKey,
    subjectPatternHash: currentRecord.subjectPatternHash,
    receivedAt: currentRecord.receivedAt,
    trustGraph: {
      senderScore: 74,
      seen: 6,
      lastSeen: null,
    },
    decisionProfile: {
      threat: 18,
      urgency: 42,
      primaryCategory: "general",
      attentionType: "review_later",
    },
    currentPriority: {
      priorityScore: 56,
      priorityBand: "medium",
    },
    store,
  });

  assert.equal(result.silenceBreak.detected, true);
  assert.equal(result.silenceBreak.source, "intra_batch");
  assert.equal(result.silenceBreak.novelSubjectPattern, true);
  assert.equal(result.dominantTemporalSignal, "silence_break");
  assert.ok(result.totalUrgencyDelta > 0);
  assert.ok(
    result.explanationNotes.some((note) => note.includes("hashed subject pattern"))
  );
});

test("follow-up on an unresolved earlier item inherits escalation pressure", () => {
  const emails: SessionEmailFixture[] = [
    {
      senderDomain: "partner.example",
      threadKey: "project-approval",
      receivedAt: new Date("2026-04-23T09:00:00.000Z"),
      primaryCategory: "general",
      subject: "Project approval needed",
    },
    {
      senderDomain: "partner.example",
      threadKey: "project-approval",
      receivedAt: new Date("2026-04-23T11:00:00.000Z"),
      primaryCategory: "general",
      subject: "Re: Project approval final follow-up",
    },
  ];

  const store = buildStore(emails);
  const firstRecord = findRecord(store, emails[0]);
  updateRecord(
    store,
    firstRecord.senderDomainHash,
    firstRecord.threadKeyHash,
    firstRecord.receivedAt,
    {
      priorityScore: 86,
      priorityBand: "high",
      primaryCategory: "general",
      threatScore: 34,
      urgencyScore: 80,
      attentionType: "act_now",
      trustedAction: "escalate",
      routingAction: "escalate",
      fpGuardActivated: false,
      fpGuardDelta: 0,
    }
  );

  const currentRecord = findRecord(store, emails[1]);
  const result = buildTemporalContext({
    senderDomainHash: currentRecord.senderDomainHash,
    threadKeyHash: currentRecord.threadKeyHash,
    clusterKey: currentRecord.clusterKey,
    subjectPatternHash: currentRecord.subjectPatternHash,
    receivedAt: currentRecord.receivedAt,
    trustGraph: {
      senderScore: 68,
      seen: 7,
      lastSeen: null,
    },
    decisionProfile: {
      threat: 48,
      urgency: 58,
      primaryCategory: "general",
      attentionType: "review_later",
    },
    currentPriority: {
      priorityScore: 61,
      priorityBand: "medium",
    },
    store,
  });

  assert.equal(result.unresolvedThread.detected, true);
  assert.equal(result.unresolvedThread.actionablePriorCount, 1);
  assert.equal(result.unresolvedThread.novelSubjectPattern, true);
  assert.equal(result.routingOverride, "escalate");
  assert.equal(result.dominantTemporalSignal, "unresolved_thread");
  assert.ok(result.totalUrgencyDelta >= 18);
});

test("multiple domains converging on a financial theme trigger coordinated-pattern handling", () => {
  const emails: SessionEmailFixture[] = [
    {
      senderDomain: "vendor-a.example",
      threadKey: "wire-1",
      receivedAt: new Date("2026-04-23T09:00:00.000Z"),
      primaryCategory: "finance_payment",
      subject: "Wire transfer confirmation",
      body: "Please review wire transfer details for the beneficiary.",
    },
    {
      senderDomain: "vendor-b.example",
      threadKey: "wire-2",
      receivedAt: new Date("2026-04-23T11:00:00.000Z"),
      primaryCategory: "finance_payment",
      subject: "Wire transfer confirmation",
      body: "Updated bank details and ACH beneficiary request.",
    },
    {
      senderDomain: "vendor-c.example",
      threadKey: "wire-3",
      receivedAt: new Date("2026-04-23T12:00:00.000Z"),
      primaryCategory: "finance_payment",
      subject: "Re: Wire transfer confirmation",
      body: "Please confirm account number and bank details.",
    },
  ];

  const store = buildStore(emails);
  for (const email of emails.slice(0, 2)) {
    const record = findRecord(store, email);
    updateRecord(store, record.senderDomainHash, record.threadKeyHash, record.receivedAt, {
      priorityScore: 84,
      priorityBand: "high",
      primaryCategory: "finance_payment",
      threatScore: 72,
      urgencyScore: 74,
      attentionType: "verify_now",
      trustedAction: "quarantine",
      routingAction: "escalate",
      fpGuardActivated: false,
      fpGuardDelta: 0,
    });
  }

  const currentRecord = findRecord(store, emails[2]);
  const result = buildTemporalContext({
    senderDomainHash: currentRecord.senderDomainHash,
    threadKeyHash: currentRecord.threadKeyHash,
    clusterKey: currentRecord.clusterKey,
    subjectPatternHash: currentRecord.subjectPatternHash,
    receivedAt: currentRecord.receivedAt,
    trustGraph: {
      senderScore: 42,
      seen: 5,
      lastSeen: null,
    },
    decisionProfile: {
      threat: 54,
      urgency: 52,
      primaryCategory: "finance_payment",
      attentionType: "review_later",
    },
    currentPriority: {
      priorityScore: 66,
      priorityBand: "medium",
    },
    store,
  });

  assert.equal(result.convergingSignal.detected, true);
  assert.equal(result.convergingSignal.campaignType, "coordinated_attack");
  assert.ok(result.convergingSignal.matchingSubjectDomains >= 1);
  assert.ok(result.totalThreatDelta > 0);
  assert.equal(result.routingOverride, "human_review");
  assert.equal(result.dominantTemporalSignal, "converging_signal");
});
