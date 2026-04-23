import { createHash, randomUUID } from "crypto";

import type { ClusterKey, SessionEmailRecord, SessionStore } from "./sessionStore.types";

/**
 * Produces a 16-character hex string from any input string.
 * Uses Node.js crypto.createHash("sha256").
 * Safe to call with empty string - returns a consistent hash.
 *
 * Pipeline step: used while the session store is being built so temporal indexing stays privacy-safe and deterministic.
 * False-positive scenario addressed: preserves sender and thread correlation without retaining raw identifiers.
 */
export function hashSignal(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Derives one of the six allowed cluster labels from already-available pipeline signals.
 *
 * Pipeline step: used during session-store construction so convergence detection works on coarse signal buckets instead of raw text.
 * False-positive scenario addressed: limits cross-email grouping to a narrow, reviewable label set instead of free-form content.
 */
export function deriveClusterKey(
  moneyMentions: string[],
  deadlines: string[],
  primaryCategory: string,
  body: string
): ClusterKey {
  const b = body.slice(0, 400).toLowerCase();

  if (moneyMentions.length >= 1) {
    return "financial_transaction";
  }

  if (
    primaryCategory === "finance_payment" ||
    ["wire transfer", "bank details", "account number", "beneficiary", "ach"].some((token) =>
      b.includes(token)
    )
  ) {
    return "payment_request";
  }

  if (
    primaryCategory.includes("scam_bec") ||
    primaryCategory === "scam_impersonation" ||
    [
      "ceo request",
      "cfo request",
      "gift card",
      "on behalf of",
      "keep this confidential",
    ].some((token) => b.includes(token))
  ) {
    return "executive_impersonation";
  }

  if (
    primaryCategory === "legal_contract" ||
    ["nda", "indemnif", "governing law", "signature required"].some((token) =>
      b.includes(token)
    )
  ) {
    return "legal_pressure";
  }

  if (deadlines.length >= 1 || primaryCategory === "deadline_scheduling") {
    return "deadline_pressure";
  }

  return "general";
}

/**
 * Builds the request-scoped in-memory session store from parsed emails.
 *
 * Pipeline step: called once per inbox request after parsing and before scoring so every email can read batch-level temporal context.
 * False-positive scenario addressed: makes later emails aware of earlier same-batch sender cadence, thread state, and cluster convergence without any persistence.
 */
export function buildSessionStore(
  parsedEmails: Array<{
    senderDomain: string;
    threadKey: string;
    receivedAt: Date | null;
    moneyMentions: string[];
    deadlines: string[];
    primaryCategory: string;
    body: string;
  }>
): SessionStore {
  const sortedEmails = [...parsedEmails].sort(
    (a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0)
  );

  const allRecords = sortedEmails.map<SessionEmailRecord>((email) => ({
    senderDomainHash: hashSignal(email.senderDomain),
    threadKeyHash: hashSignal(email.threadKey),
    clusterKey: deriveClusterKey(
      email.moneyMentions,
      email.deadlines,
      email.primaryCategory,
      email.body
    ),
    receivedAt: email.receivedAt?.getTime() ?? 0,
    priorityScore: 0,
    priorityBand: "low",
    primaryCategory: email.primaryCategory,
    threatScore: 0,
    urgencyScore: 0,
    attentionType: "review_later",
    trustedAction: "",
    routingAction: "",
    fpGuardActivated: false,
    fpGuardDelta: 0,
    scored: false,
  }));

  const bySenderDomain = new Map<string, SessionEmailRecord[]>();
  const byThreadKey = new Map<string, SessionEmailRecord[]>();
  const byCluster = new Map<string, SessionEmailRecord[]>();

  /**
   * Inserts a record into one of the pre-sorted index maps.
   *
   * Pipeline step: internal helper used only during store construction.
   * False-positive scenario addressed: guarantees every temporal lookup sees the same record ordering regardless of which index is queried.
   */
  function pushToIndex(
    index: Map<string, SessionEmailRecord[]>,
    key: string,
    record: SessionEmailRecord
  ): void {
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(record);
      return;
    }
    index.set(key, [record]);
  }

  for (const record of allRecords) {
    pushToIndex(bySenderDomain, record.senderDomainHash, record);
    pushToIndex(byThreadKey, record.threadKeyHash, record);
    pushToIndex(byCluster, record.clusterKey, record);
  }

  return {
    bySenderDomain,
    byThreadKey,
    byCluster,
    allRecords,
    sessionId: randomUUID(),
    emailCount: allRecords.length,
    builtAt: Date.now(),
  };
}

/**
 * Updates one pre-inserted session-store record after scoring finishes for that email.
 *
 * Pipeline step: called after false-positive correction so later emails can read trustworthy scored context from earlier emails.
 * False-positive scenario addressed: uses the explicit scored flag so detectors can ignore placeholder records that have not completed the pipeline yet.
 */
export function updateRecord(
  store: SessionStore,
  senderDomainHash: string,
  threadKeyHash: string,
  receivedAt: number,
  scores: {
    priorityScore: number;
    priorityBand: "high" | "medium" | "low";
    primaryCategory: string;
    threatScore: number;
    urgencyScore: number;
    attentionType: string;
    trustedAction: string;
    routingAction: string;
    fpGuardActivated: boolean;
    fpGuardDelta: number;
  }
): void {
  const candidates = store.bySenderDomain.get(senderDomainHash) ?? [];
  const record = candidates.find(
    (candidate) =>
      candidate.threadKeyHash === threadKeyHash && candidate.receivedAt === receivedAt
  );

  if (!record) {
    return;
  }

  record.priorityScore = scores.priorityScore;
  record.priorityBand = scores.priorityBand;
  record.primaryCategory = scores.primaryCategory;
  record.threatScore = scores.threatScore;
  record.urgencyScore = scores.urgencyScore;
  record.attentionType = scores.attentionType;
  record.trustedAction = scores.trustedAction;
  record.routingAction = scores.routingAction;
  record.fpGuardActivated = scores.fpGuardActivated;
  record.fpGuardDelta = scores.fpGuardDelta;
  record.scored = true;
}

/**
 * Returns all records for one sender-domain hash.
 *
 * Pipeline step: silence-break detection uses this O(1) sender view to measure same-batch cadence.
 * False-positive scenario addressed: confines cadence math to one sender-domain slice instead of the whole batch.
 */
export function getSenderRecords(
  store: SessionStore,
  senderDomainHash: string
): SessionEmailRecord[] {
  return store.bySenderDomain.get(senderDomainHash) ?? [];
}

/**
 * Returns all records for one thread-key hash.
 *
 * Pipeline step: unresolved-thread detection uses this O(1) thread view to find earlier scored messages in the same thread.
 * False-positive scenario addressed: prevents urgency carry-over from unrelated emails.
 */
export function getThreadRecords(
  store: SessionStore,
  threadKeyHash: string
): SessionEmailRecord[] {
  return store.byThreadKey.get(threadKeyHash) ?? [];
}

/**
 * Returns all records for one cluster key, excluding the current sender domain.
 *
 * Pipeline step: converging-signal detection uses this O(1) cluster view to measure cross-sender convergence.
 * False-positive scenario addressed: prevents one noisy domain from manufacturing a fake coordinated pattern by itself.
 */
export function getClusterRecords(
  store: SessionStore,
  clusterKey: string,
  excludeDomainHash: string
): SessionEmailRecord[] {
  return (store.byCluster.get(clusterKey) ?? []).filter(
    (record) => record.senderDomainHash !== excludeDomainHash
  );
}

/**
 * Computes consecutive time gaps in hours for an ascending record sequence.
 *
 * Pipeline step: silence-break detection uses this to estimate sender cadence from the current batch.
 * False-positive scenario addressed: keeps cadence grounded in actual received-time spacing instead of textual urgency.
 */
export function computeGapsHours(records: SessionEmailRecord[]): number[] {
  if (records.length < 2) {
    return [];
  }

  const gaps: number[] = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    gaps.push((next.receivedAt - current.receivedAt) / 3_600_000);
  }
  return gaps;
}

/**
 * Computes the median value from a number array.
 *
 * Pipeline step: cadence analysis uses the median so one outlier gap does not distort expected timing.
 * False-positive scenario addressed: avoids false silence breaks caused by a single extreme interval.
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
