import { createHash, randomUUID } from "crypto";

import type { SessionEmailRecord, SessionStore } from "./sessionStore.types";

/**
 * Produces a 16-character hex string from any input string.
 * Uses Node.js crypto.createHash('sha256').
 * Safe to call with empty string - returns a consistent hash.
 *
 * Pipeline step: used at session-store construction time so all temporal indexing stays content-free and deterministic.
 * False-positive scenario addressed: keeps sender and thread correlation stable without storing raw identifiers.
 */
export function hashSignal(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Derives a signal cluster label from pipeline outputs.
 * Returns exactly one of 6 string literals.
 * Never stores or processes raw email content beyond
 * the first 400 characters of body.
 *
 * Pipeline step: used during session-store construction so convergence detection can operate on coarse signal buckets instead of raw content.
 * False-positive scenario addressed: limits cross-email linking to high-signal clusters and avoids leaking message text into memory.
 */
export function deriveClusterKey(
  moneyMentions: string[],
  deadlines: string[],
  primaryCategory: string,
  body: string
): string {
  const body400 = body.slice(0, 400).toLowerCase();

  if (moneyMentions.length >= 1) {
    return "financial_transaction";
  }

  if (
    primaryCategory === "finance_payment" ||
    ["wire transfer", "bank details", "account number", "beneficiary", "ach"].some(
      (phrase) => body400.includes(phrase)
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
    ].some((phrase) => body400.includes(phrase))
  ) {
    return "executive_impersonation";
  }

  if (
    primaryCategory === "legal_contract" ||
    ["nda", "indemnif", "governing law", "signature required"].some((phrase) =>
      body400.includes(phrase)
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
 * Computes the median value from a number array.
 * Returns 0 for empty arrays.
 *
 * Pipeline step: used by intra-batch cadence math before any temporal urgency boost is calculated.
 * False-positive scenario addressed: avoids single outlier gaps distorting the sender's expected cadence.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Computes consecutive time gaps in hours between a sorted array of session records.
 * Returns empty array if fewer than 2 records.
 *
 * Pipeline step: used by silence-break detection to measure sender cadence within the current batch.
 * False-positive scenario addressed: ensures silence boosts are grounded in observed timing gaps, not keyword urgency.
 */
export function computeGapsHours(records: SessionEmailRecord[]): number[] {
  if (records.length < 2) return [];
  const gaps: number[] = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    gaps.push((next.receivedAt - current.receivedAt) / 3_600_000);
  }
  return gaps;
}

/**
 * Builds the in-memory session store from all parsed emails in the current batch.
 *
 * Pipeline step: called once per inbox scan after parsing and before scoring, so every email can see the batch-level temporal structure.
 * False-positive scenario addressed: lets later emails inherit thread and convergence context from earlier ones without any disk or database dependency.
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
  const allRecords = parsedEmails
    .map<SessionEmailRecord>((email) => ({
      senderDomainHash: hashSignal(email.senderDomain || ""),
      threadKeyHash: hashSignal(email.threadKey || ""),
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
      trustedAction: "allow",
      routingAction: "auto_triage",
      fpGuardActivated: false,
      fpGuardDelta: 0,
    }))
    .sort((a, b) => a.receivedAt - b.receivedAt);

  const bySenderDomain = new Map<string, SessionEmailRecord[]>();
  const byThreadKey = new Map<string, SessionEmailRecord[]>();
  const byCluster = new Map<string, SessionEmailRecord[]>();

  /**
   * Registers one record into every session index.
   *
   * Pipeline step: internal helper used only during store construction.
   * False-positive scenario addressed: keeps all index views aligned so temporal lookups never diverge on partially inserted records.
   */
  function indexRecord(map: Map<string, SessionEmailRecord[]>, key: string, record: SessionEmailRecord) {
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(record);
      return;
    }
    map.set(key, [record]);
  }

  for (const record of allRecords) {
    indexRecord(bySenderDomain, record.senderDomainHash, record);
    indexRecord(byThreadKey, record.threadKeyHash, record);
    indexRecord(byCluster, record.clusterKey, record);
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
 * Updates a pre-inserted record with post-scoring outputs.
 *
 * Pipeline step: called after false-positive correction so later emails in the batch can read the latest scored state.
 * False-positive scenario addressed: prevents unresolved-thread and convergence detectors from treating unscored placeholders as meaningful prior evidence.
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
  const senderRecords = store.bySenderDomain.get(senderDomainHash) ?? [];
  const record =
    senderRecords.find(
      (entry) =>
        entry.threadKeyHash === threadKeyHash &&
        entry.receivedAt === receivedAt &&
        entry.priorityScore === 0
    ) ??
    senderRecords.find(
      (entry) => entry.threadKeyHash === threadKeyHash && entry.receivedAt === receivedAt
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
}

/**
 * Returns all records for a sender-domain hash, sorted by receivedAt ascending.
 *
 * Pipeline step: silence-break detection uses this as its O(1) sender history view.
 * False-positive scenario addressed: keeps cadence math restricted to same-domain activity inside the current batch.
 */
export function getSenderRecords(
  store: SessionStore,
  senderDomainHash: string
): SessionEmailRecord[] {
  return [...(store.bySenderDomain.get(senderDomainHash) ?? [])].sort(
    (a, b) => a.receivedAt - b.receivedAt
  );
}

/**
 * Returns all records for a thread-key hash, sorted by receivedAt ascending.
 *
 * Pipeline step: unresolved-thread detection uses this to find earlier scored activity in the same thread.
 * False-positive scenario addressed: keeps follow-up pressure localized to the same thread rather than across unrelated messages.
 */
export function getThreadRecords(
  store: SessionStore,
  threadKeyHash: string
): SessionEmailRecord[] {
  return [...(store.byThreadKey.get(threadKeyHash) ?? [])].sort(
    (a, b) => a.receivedAt - b.receivedAt
  );
}

/**
 * Returns all records for a cluster key, excluding the current sender domain hash.
 *
 * Pipeline step: converging-signal detection uses this to look across other senders in the same batch.
 * False-positive scenario addressed: prevents a single noisy sender from manufacturing a fake multi-party campaign.
 */
export function getClusterRecords(
  store: SessionStore,
  clusterKey: string,
  excludeDomainHash: string
): SessionEmailRecord[] {
  return [...(store.byCluster.get(clusterKey) ?? [])]
    .filter((record) => record.senderDomainHash !== excludeDomainHash)
    .sort((a, b) => a.receivedAt - b.receivedAt);
}
