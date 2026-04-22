/**
 * Derived signal record for one email within the current session.
 * Contains NO email content. NO PII. NO raw text.
 * Built from pipeline outputs only - safe by construction.
 *
 * Privacy invariant: every field must be explainable to a
 * regulator without referencing email content, names, or addresses.
 */
export type SessionEmailRecord = {
  senderDomainHash: string;
  threadKeyHash: string;
  clusterKey: string;
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
};

/**
 * The in-memory session store.
 * One instance per /api/inbox request.
 * Discarded when the request completes.
 *
 * Keyed by senderDomainHash for O(1) sender lookups.
 * Keyed by threadKeyHash for O(1) thread lookups.
 * All records also kept in receivedAt-sorted order
 * for cadence and convergence calculations.
 */
export type SessionStore = {
  bySenderDomain: Map<string, SessionEmailRecord[]>;
  byThreadKey: Map<string, SessionEmailRecord[]>;
  byCluster: Map<string, SessionEmailRecord[]>;
  allRecords: SessionEmailRecord[];
  sessionId: string;
  emailCount: number;
  builtAt: number;
};
