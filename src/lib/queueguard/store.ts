import crypto from "crypto";

import { connectMongo, isMongoConfigured } from "@/lib/db/mongoose";
import { QueueGuardLedgerModel } from "@/lib/models/QueueGuardLedger";
import { QueueGuardSessionModel } from "@/lib/models/QueueGuardSession";

import { QUEUEGUARD_POLICY } from "./policy";
import { sha256Hex } from "./hash";
import type { QueueDecision, QueueEventType, QueueLedgerEntry, QueueSessionState, StepUpChallenge } from "./types";

type QueueGuardStore = {
  sessions: Record<string, QueueSessionState>;
  ledger: QueueLedgerEntry[];
};

type QueueGuardSessionRecord = {
  sessionId: string;
  createdAtMs: number;
  lastSeenAtMs: number;
  trustedUntilMs?: number;
  frictionUsed: number;
  challengeAttempts: number;
  challengePasses: number;
  challengeFailures: number;
  pendingChallenge?: QueueSessionState["pendingChallenge"];
  lastDecision?: QueueDecision;
  lastEventType?: QueueEventType;
  history: QueueSessionState["history"];
  payloadCounts?: Map<string, number> | Record<string, number>;
  sequenceCounts?: Map<string, number> | Record<string, number>;
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

function createSession(sessionId: string): QueueSessionState {
  const now = Date.now();
  return {
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
}

function normalizeNumberRecord(
  value: Map<string, number> | Record<string, number> | undefined
): Record<string, number> {
  if (!value) return {};
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Number(count) || 0])
  );
}

function hydrateSession(record: QueueGuardSessionRecord): QueueSessionState {
  return {
    sessionId: record.sessionId,
    createdAt: record.createdAtMs,
    lastSeenAt: record.lastSeenAtMs,
    trustedUntil: record.trustedUntilMs,
    frictionUsed: record.frictionUsed,
    challengeAttempts: record.challengeAttempts,
    challengePasses: record.challengePasses,
    challengeFailures: record.challengeFailures,
    pendingChallenge: record.pendingChallenge,
    lastDecision: record.lastDecision,
    lastEventType: record.lastEventType,
    history: record.history || [],
    payloadCounts: normalizeNumberRecord(record.payloadCounts),
    sequenceCounts: normalizeNumberRecord(record.sequenceCounts),
  };
}

function serializeSession(session: QueueSessionState) {
  return {
    sessionId: session.sessionId,
    createdAtMs: session.createdAt,
    lastSeenAtMs: session.lastSeenAt,
    trustedUntilMs: session.trustedUntil,
    frictionUsed: session.frictionUsed,
    challengeAttempts: session.challengeAttempts,
    challengePasses: session.challengePasses,
    challengeFailures: session.challengeFailures,
    pendingChallenge: session.pendingChallenge,
    lastDecision: session.lastDecision,
    lastEventType: session.lastEventType,
    history: session.history,
    payloadCounts: session.payloadCounts,
    sequenceCounts: session.sequenceCounts,
  };
}

export async function ensureSession(sessionId: string): Promise<QueueSessionState> {
  if (!isMongoConfigured()) {
    const store = getGlobalStore();
    const existing = store.sessions[sessionId];
    if (existing) {
      existing.lastSeenAt = Date.now();
      return existing;
    }
    const session = createSession(sessionId);
    store.sessions[sessionId] = session;
    return session;
  }

  await connectMongo();
  const record = await QueueGuardSessionModel.findOne({ sessionId }).lean<QueueGuardSessionRecord | null>();
  if (record) {
    const session = hydrateSession(record);
    session.lastSeenAt = Date.now();
    return session;
  }

  const session = createSession(sessionId);
  await QueueGuardSessionModel.create(serializeSession(session));
  return session;
}

export async function getSession(sessionId: string): Promise<QueueSessionState | null> {
  if (!isMongoConfigured()) {
    const store = getGlobalStore();
    return store.sessions[sessionId] || null;
  }

  await connectMongo();
  const record = await QueueGuardSessionModel.findOne({ sessionId }).lean<QueueGuardSessionRecord | null>();
  return record ? hydrateSession(record) : null;
}

export async function resetSession(sessionId: string): Promise<QueueSessionState> {
  if (!isMongoConfigured()) {
    const store = getGlobalStore();
    delete store.sessions[sessionId];
    const session = createSession(sessionId);
    store.sessions[sessionId] = session;
    return session;
  }

  await connectMongo();
  await QueueGuardSessionModel.deleteOne({ sessionId });
  const session = createSession(sessionId);
  await QueueGuardSessionModel.create(serializeSession(session));
  return session;
}

export async function saveSession(session: QueueSessionState): Promise<void> {
  session.lastSeenAt = Date.now();

  if (!isMongoConfigured()) {
    const store = getGlobalStore();
    store.sessions[session.sessionId] = session;
    return;
  }

  await connectMongo();
  await QueueGuardSessionModel.updateOne(
    { sessionId: session.sessionId },
    { $set: serializeSession(session) },
    { upsert: true }
  );
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

export async function appendLedgerEvent(args: {
  sessionId: string;
  eventKind: "score" | "verify";
  eventType: QueueEventType;
  attemptedAction: QueueEventType;
  decision: QueueDecision;
  stepUpOutcome: "none" | "issued" | "pass" | "fail";
  latencyMs: number;
}): Promise<QueueLedgerEntry> {
  if (!isMongoConfigured()) {
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

  await connectMongo();
  const previous = await QueueGuardLedgerModel.findOne({}).sort({ ts: -1 }).select("entryHash").lean<{ entryHash: string } | null>();
  const prevHash = previous?.entryHash || "GENESIS";
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

  await QueueGuardLedgerModel.create({
    ledgerId: entry.id,
    ts: entry.ts,
    sessionId: entry.sessionId,
    eventKind: entry.eventKind,
    eventType: entry.eventType,
    attemptedAction: entry.attemptedAction,
    decisionAction: entry.decisionAction,
    risk: entry.risk,
    topFactorKeys: entry.topFactorKeys,
    stepUpLevel: entry.stepUpLevel,
    stepUpOutcome: entry.stepUpOutcome,
    policyVersion: entry.policyVersion,
    frictionBudget: entry.frictionBudget,
    latencyMs: entry.latencyMs,
    prevHash: entry.prevHash,
    entryHash: entry.entryHash,
  });

  return entry;
}

export async function getLedger(args?: { action?: string; limit?: number }): Promise<QueueLedgerEntry[]> {
  const actionFilter = args?.action?.trim().toUpperCase();
  const limit = Math.max(1, Math.min(args?.limit ?? 150, 500));

  if (!isMongoConfigured()) {
    const store = getGlobalStore();
    const reversed = [...store.ledger].reverse();
    const filtered = actionFilter
      ? reversed.filter((entry) => entry.decisionAction === actionFilter)
      : reversed;
    return filtered.slice(0, limit);
  }

  await connectMongo();
  const query = actionFilter ? { decisionAction: actionFilter } : {};
  const records = await QueueGuardLedgerModel.find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .lean<
      Array<{
        ledgerId: string;
        ts: string;
        sessionId: string;
        eventKind: "score" | "verify";
        eventType: QueueEventType;
        attemptedAction: QueueEventType;
        decisionAction: QueueDecision["action"];
        risk: number;
        topFactorKeys: string[];
        stepUpLevel: 0 | 1 | 2;
        stepUpOutcome: "none" | "issued" | "pass" | "fail";
        policyVersion: string;
        frictionBudget: QueueDecision["frictionBudget"];
        latencyMs: number;
        prevHash: string;
        entryHash: string;
      }>
    >();

  return records.map((record) => ({
    id: record.ledgerId,
    ts: record.ts,
    sessionId: record.sessionId,
    eventKind: record.eventKind,
    eventType: record.eventType,
    attemptedAction: record.attemptedAction,
    decisionAction: record.decisionAction,
    risk: record.risk,
    topFactorKeys: record.topFactorKeys,
    stepUpLevel: record.stepUpLevel,
    stepUpOutcome: record.stepUpOutcome,
    policyVersion: record.policyVersion,
    frictionBudget: record.frictionBudget,
    latencyMs: record.latencyMs,
    prevHash: record.prevHash,
    entryHash: record.entryHash,
  }));
}
