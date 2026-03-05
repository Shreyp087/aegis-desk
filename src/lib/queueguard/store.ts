import crypto from "crypto";
import { QUEUEGUARD_POLICY } from "./policy";
import { sha256Hex } from "./hash";
import type { QueueDecision, QueueEventType, QueueLedgerEntry, QueueSessionState, StepUpChallenge } from "./types";

type QueueGuardStore = {
  sessions: Record<string, QueueSessionState>;
  ledger: QueueLedgerEntry[];
};

const MAX_LEDGER_ENTRIES = 600;
const TRUST_WINDOW_MS = 60_000;

function getGlobalStore(): QueueGuardStore {
  const globalKey = "__aegisQueueGuardStore__" as const;
  const root = globalThis as unknown as Record<string, QueueGuardStore | undefined>;
  if (!root[globalKey]) {
    root[globalKey] = {
      sessions: {},
      ledger: [],
    };
  }
  return root[globalKey] as QueueGuardStore;
}

export function ensureSession(sessionId: string): QueueSessionState {
  const store = getGlobalStore();
  const now = Date.now();
  const existing = store.sessions[sessionId];
  if (existing) {
    existing.lastSeenAt = now;
    return existing;
  }

  const session: QueueSessionState = {
    sessionId,
    createdAt: now,
    lastSeenAt: now,
    frictionUsed: 0,
    challengeAttempts: 0,
    challengePasses: 0,
    challengeFailures: 0,
    history: [],
    payloadCounts: {},
    sequenceCounts: {},
  };
  store.sessions[sessionId] = session;
  return session;
}

export function getSession(sessionId: string): QueueSessionState | null {
  const store = getGlobalStore();
  return store.sessions[sessionId] || null;
}

export function resetSession(sessionId: string): QueueSessionState {
  const store = getGlobalStore();
  delete store.sessions[sessionId];
  return ensureSession(sessionId);
}

export function applyChallengeSuccess(session: QueueSessionState) {
  session.challengePasses += 1;
  session.pendingChallenge = undefined;
  session.trustedUntil = Date.now() + TRUST_WINDOW_MS;
}

export function applyChallengeFailure(session: QueueSessionState) {
  session.challengeFailures += 1;
}

export function issueChallenge(session: QueueSessionState, level: 1 | 2): StepUpChallenge {
  const challengeId = crypto.randomUUID();
  const now = Date.now();

  if (level === 1) {
    session.pendingChallenge = {
      challengeId,
      level,
      kind: "hold",
      issuedAt: now,
    };
    return {
      challengeId,
      level,
      kind: "hold",
      holdDurationMs: 2000,
    };
  }

  const otpCode = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = now + 90_000;
  session.pendingChallenge = {
    challengeId,
    level,
    kind: "otp",
    issuedAt: now,
    expiresAt,
    otpCode,
  };
  return {
    challengeId,
    level,
    kind: "otp",
    otpForDemo: otpCode,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function registerChallengeAttempt(session: QueueSessionState) {
  session.challengeAttempts += 1;
}

export function recordAction(
  session: QueueSessionState,
  eventType: QueueEventType,
  payloadHash: string,
  sequenceFingerprint: string,
  at = Date.now()
) {
  session.history.push({ ts: at, eventType, payloadHash, sequenceFingerprint });
  if (session.history.length > 80) {
    session.history.splice(0, session.history.length - 80);
  }
  session.payloadCounts[payloadHash] = (session.payloadCounts[payloadHash] || 0) + 1;
  session.sequenceCounts[sequenceFingerprint] = (session.sequenceCounts[sequenceFingerprint] || 0) + 1;
  session.lastSeenAt = at;
}

export function getFrictionBudget(session: QueueSessionState) {
  const cap = QUEUEGUARD_POLICY.frictionCap;
  const used = Math.max(0, Math.min(cap, session.frictionUsed));
  return {
    cap,
    used,
    remaining: Math.max(0, cap - used),
  };
}

export function consumeFriction(session: QueueSessionState, level: 1 | 2) {
  session.frictionUsed = Math.min(
    QUEUEGUARD_POLICY.frictionCap,
    session.frictionUsed + QUEUEGUARD_POLICY.challengeCost[level]
  );
}

export function appendLedgerEvent(args: {
  sessionId: string;
  eventKind: "score" | "verify";
  eventType: QueueEventType;
  attemptedAction: QueueEventType;
  decision: QueueDecision;
  stepUpOutcome: "none" | "issued" | "pass" | "fail";
  latencyMs: number;
}): QueueLedgerEntry {
  const store = getGlobalStore();
  const prevHash = store.ledger.length > 0 ? store.ledger[store.ledger.length - 1].entryHash : "GENESIS";
  const entryBase = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId: args.sessionId,
    eventKind: args.eventKind,
    eventType: args.eventType,
    attemptedAction: args.attemptedAction,
    decisionAction: args.decision.action,
    risk: args.decision.risk,
    topFactorKeys: args.decision.topFactors.map((f) => f.key),
    stepUpLevel: args.decision.stepUpLevel,
    stepUpOutcome: args.stepUpOutcome,
    policyVersion: args.decision.policyVersion,
    frictionBudget: args.decision.frictionBudget,
    latencyMs: args.latencyMs,
    prevHash,
  };
  const entryHash = sha256Hex(`${prevHash}|${JSON.stringify(entryBase)}`);

  const entry: QueueLedgerEntry = {
    ...entryBase,
    entryHash,
  };

  store.ledger.push(entry);
  if (store.ledger.length > MAX_LEDGER_ENTRIES) {
    store.ledger.splice(0, store.ledger.length - MAX_LEDGER_ENTRIES);
  }
  return entry;
}

export function getLedger(args?: { action?: string; limit?: number }): QueueLedgerEntry[] {
  const store = getGlobalStore();
  const actionFilter = args?.action?.trim().toUpperCase();
  const limit = Math.max(1, Math.min(args?.limit ?? 150, 500));
  const reversed = [...store.ledger].reverse();

  const filtered = actionFilter
    ? reversed.filter((entry) => entry.decisionAction === actionFilter)
    : reversed;
  return filtered.slice(0, limit);
}
