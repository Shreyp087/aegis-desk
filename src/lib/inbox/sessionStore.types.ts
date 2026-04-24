/**
 * One derived-signal record per email in the current batch.
 *
 * PRIVACY INVARIANT - enforced by buildSessionStore() signature:
 * Every field is a pipeline output (hash, score, label, timestamp).
 * No email content. No sender names. No addresses. No subjects.
 * A user can read this file to a regulator without mentioning
 * a single email.
 */
export type SessionEmailRecord = {
  senderDomainHash: string;
  threadKeyHash: string;
  clusterKey: ClusterKey;
  subjectPatternHash: string;
  receivedAt: number;
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
  scored: boolean;
};

/**
 * The six cluster labels - exhaustive, no other values permitted.
 * Used as keys in byCluster Map and for convergence detection.
 */
export type ClusterKey =
  | "financial_transaction"
  | "payment_request"
  | "executive_impersonation"
  | "legal_pressure"
  | "deadline_pressure"
  | "general";

/**
 * The in-memory session store.
 * One instance per /api/inbox request.
 * Built once before scoring. Updated per email during scoring.
 * Abandoned (GC collected) after alerts[] is returned.
 *
 * Three indexes for O(1) lookups by the three detectors.
 * allRecords is the authoritative sorted list.
 */
export type SessionStore = {
  bySenderDomain: Map<string, SessionEmailRecord[]>;
  byThreadKey: Map<string, SessionEmailRecord[]>;
  byCluster: Map<string, SessionEmailRecord[]>;
  bySubjectPattern: Map<string, SessionEmailRecord[]>;
  allRecords: SessionEmailRecord[];
  sessionId: string;
  emailCount: number;
  builtAt: number;
};
