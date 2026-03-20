import crypto from "crypto";
import fs from "fs/promises";
import { connectMongo, isMongoConfigured } from "@/lib/db/mongoose";
import { LocalTicketRecordModel } from "@/lib/models/LocalTicketRecord";
import { appendTicketAuditEvent } from "./audit";
import { getTicketsDir, getTicketsStatePath } from "./paths";
import type {
  LocalTicket,
  RiskSummary,
  TicketAdminMeta,
  TicketAdminStatus,
  TicketDecision,
  TicketSyncState,
} from "./types";

type TicketsStateFileV2 = {
  version: 2;
  updatedAt: string;
  ticketsById: Record<string, LocalTicket>;
  ticketsByEmailId: Record<string, string>;
};

type LegacyLocalTicketV1 = Omit<LocalTicket, "admin"> & {
  admin?: never;
};

type TicketsStateFileV1 = {
  version: 1;
  updatedAt: string;
  ticketsById: Record<string, LegacyLocalTicketV1>;
  ticketsByEmailId: Record<string, string>;
};

type TicketsStateUnknown = Partial<TicketsStateFileV1> &
  Partial<TicketsStateFileV2> & {
    version?: number;
  };

const STATE_VERSION = 2 as const;

type CreateLocalTicketInput = {
  sourceEmailId: string;
  channel?: "inbox" | "user_dashboard";
  sender?: string;
  requesterName?: string;
  subject?: string;
  details?: string;
  date?: string;
  risk: RiskSummary;
  decision: TicketDecision;
  confidence: number;
  initialSyncState: TicketSyncState;
};

type AdminPatch = {
  status?: TicketAdminStatus;
  assignee?: string;
  notes?: string;
};

function toMaybeString(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

function hydrateLocalTicket(
  doc: {
    localTicketId: string;
    peppermintTicketId?: string | null;
    sourceEmailId: string;
    channel?: "inbox" | "user_dashboard";
    sender?: string;
    requesterName?: string;
    subject?: string;
    details?: string;
    date?: string;
    risk: RiskSummary;
    decision: TicketDecision;
    confidence: number;
    syncState: TicketSyncState;
    lastSyncAttemptAt?: Date | null;
    lastSyncError?: string;
    admin: {
      status: TicketAdminStatus;
      assignee?: string;
      notes?: string;
      updatedAt: Date;
    };
    createdAt: Date;
    updatedAt: Date;
  }
): LocalTicket {
  return {
    localTicketId: doc.localTicketId,
    peppermintTicketId: doc.peppermintTicketId ?? null,
    sourceEmailId: doc.sourceEmailId,
    channel: doc.channel || "inbox",
    sender: toMaybeString(doc.sender),
    requesterName: toMaybeString(doc.requesterName),
    subject: toMaybeString(doc.subject),
    details: toMaybeString(doc.details),
    date: toMaybeString(doc.date),
    risk: doc.risk,
    decision: doc.decision,
    confidence: doc.confidence,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    syncState: doc.syncState,
    lastSyncAttemptAt: doc.lastSyncAttemptAt ? doc.lastSyncAttemptAt.toISOString() : undefined,
    lastSyncError: toMaybeString(doc.lastSyncError),
    admin: {
      status: doc.admin.status,
      assignee: toMaybeString(doc.admin.assignee),
      notes: toMaybeString(doc.admin.notes),
      updatedAt: doc.admin.updatedAt.toISOString(),
    },
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function ensureTicketsDir() {
  await fs.mkdir(getTicketsDir(), { recursive: true });
}

function defaultAdminMeta(now: string): TicketAdminMeta {
  return {
    status: "new",
    updatedAt: now,
  };
}

function upgradeV1toV2(state: TicketsStateFileV1): TicketsStateFileV2 {
  const ticketsById: Record<string, LocalTicket> = {};
  for (const [id, ticket] of Object.entries(state.ticketsById || {})) {
    ticketsById[id] = {
      ...ticket,
      admin: defaultAdminMeta(ticket.updatedAt || new Date().toISOString()),
    };
  }
  return {
    version: 2,
    updatedAt: state.updatedAt || new Date().toISOString(),
    ticketsById,
    ticketsByEmailId: state.ticketsByEmailId || {},
  };
}

function normalizeState(parsed: TicketsStateUnknown): TicketsStateFileV2 {
  if (parsed.version === 2 && parsed.ticketsById && parsed.ticketsByEmailId) {
    return parsed as TicketsStateFileV2;
  }
  if (parsed.version === 1 && parsed.ticketsById && parsed.ticketsByEmailId) {
    return upgradeV1toV2(parsed as TicketsStateFileV1);
  }
  throw new Error("Invalid tickets state format");
}

async function readState(): Promise<TicketsStateFileV2> {
  const p = getTicketsStatePath();
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as TicketsStateUnknown;
    return normalizeState(parsed);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      const now = new Date().toISOString();
      return {
        version: STATE_VERSION,
        updatedAt: now,
        ticketsById: {},
        ticketsByEmailId: {},
      };
    }
    throw error;
  }
}

async function writeState(state: TicketsStateFileV2) {
  await ensureTicketsDir();
  const p = getTicketsStatePath();
  const tmp = `${p}.tmp`;
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, p);
}

export async function createLocalTicket(input: CreateLocalTicketInput): Promise<LocalTicket> {
  if (isMongoConfigured()) {
    await connectMongo();
    const existing = await LocalTicketRecordModel.findOne({ sourceEmailId: input.sourceEmailId }).lean<{
      localTicketId: string;
      peppermintTicketId?: string | null;
      sourceEmailId: string;
      channel?: "inbox" | "user_dashboard";
      sender?: string;
      requesterName?: string;
      subject?: string;
      details?: string;
      date?: string;
      risk: RiskSummary;
      decision: TicketDecision;
      confidence: number;
      syncState: TicketSyncState;
      lastSyncAttemptAt?: Date | null;
      lastSyncError?: string;
      admin: { status: TicketAdminStatus; assignee?: string; notes?: string; updatedAt: Date };
      createdAt: Date;
      updatedAt: Date;
    } | null>();
    if (existing) return hydrateLocalTicket(existing);

    const now = new Date();
    const created = await LocalTicketRecordModel.create({
      localTicketId: crypto.randomUUID(),
      peppermintTicketId: null,
      sourceEmailId: input.sourceEmailId,
      channel: input.channel || "inbox",
      sender: input.sender || "",
      requesterName: input.requesterName || "",
      subject: input.subject || "",
      details: input.details || "",
      date: input.date || "",
      risk: input.risk,
      decision: input.decision,
      confidence: input.confidence,
      syncState: input.initialSyncState,
      admin: defaultAdminMeta(now.toISOString()),
    });

    const ticket = hydrateLocalTicket({
      localTicketId: created.localTicketId,
      peppermintTicketId: created.peppermintTicketId,
      sourceEmailId: created.sourceEmailId,
      channel: created.channel,
      sender: created.sender,
      requesterName: created.requesterName,
      subject: created.subject,
      details: created.details,
      date: created.date,
      risk: created.risk,
      decision: created.decision,
      confidence: created.confidence,
      syncState: created.syncState,
      lastSyncAttemptAt: created.lastSyncAttemptAt,
      lastSyncError: created.lastSyncError,
      admin: {
        status: created.admin.status,
        assignee: created.admin.assignee,
        notes: created.admin.notes,
        updatedAt: created.admin.updatedAt,
      },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });

    await appendTicketAuditEvent({
      type: "ticket.created",
      at: ticket.createdAt,
      localTicketId: ticket.localTicketId,
      sourceEmailId: input.sourceEmailId,
      decision: input.decision,
      confidence: input.confidence,
      syncState: ticket.syncState,
    });

    return ticket;
  }

  const state = await readState();
  const now = new Date().toISOString();

  const existingId = state.ticketsByEmailId[input.sourceEmailId];
  if (existingId) return state.ticketsById[existingId];

  const localTicketId = crypto.randomUUID();
  const ticket: LocalTicket = {
    localTicketId,
    peppermintTicketId: null,
    sourceEmailId: input.sourceEmailId,
    channel: input.channel || "inbox",
    sender: input.sender,
    requesterName: input.requesterName,
    subject: input.subject,
    details: input.details,
    date: input.date,
    risk: input.risk,
    decision: input.decision,
    confidence: input.confidence,
    createdAt: now,
    updatedAt: now,
    syncState: input.initialSyncState,
    admin: defaultAdminMeta(now),
  };

  state.ticketsById[localTicketId] = ticket;
  state.ticketsByEmailId[input.sourceEmailId] = localTicketId;
  await writeState(state);

  await appendTicketAuditEvent({
    type: "ticket.created",
    at: now,
    localTicketId,
    sourceEmailId: input.sourceEmailId,
    decision: input.decision,
    confidence: input.confidence,
    syncState: ticket.syncState,
  });

  return ticket;
}

export async function getTicketByLocalId(localTicketId: string): Promise<LocalTicket | null> {
  if (isMongoConfigured()) {
    await connectMongo();
    const ticket = await LocalTicketRecordModel.findOne({ localTicketId }).lean<{
      localTicketId: string;
      peppermintTicketId?: string | null;
      sourceEmailId: string;
      channel?: "inbox" | "user_dashboard";
      sender?: string;
      requesterName?: string;
      subject?: string;
      details?: string;
      date?: string;
      risk: RiskSummary;
      decision: TicketDecision;
      confidence: number;
      syncState: TicketSyncState;
      lastSyncAttemptAt?: Date | null;
      lastSyncError?: string;
      admin: { status: TicketAdminStatus; assignee?: string; notes?: string; updatedAt: Date };
      createdAt: Date;
      updatedAt: Date;
    } | null>();
    return ticket ? hydrateLocalTicket(ticket) : null;
  }

  const state = await readState();
  return state.ticketsById[localTicketId] || null;
}

export async function getTicketByEmailId(sourceEmailId: string): Promise<LocalTicket | null> {
  if (isMongoConfigured()) {
    await connectMongo();
    const ticket = await LocalTicketRecordModel.findOne({ sourceEmailId }).lean<{
      localTicketId: string;
      peppermintTicketId?: string | null;
      sourceEmailId: string;
      channel?: "inbox" | "user_dashboard";
      sender?: string;
      requesterName?: string;
      subject?: string;
      details?: string;
      date?: string;
      risk: RiskSummary;
      decision: TicketDecision;
      confidence: number;
      syncState: TicketSyncState;
      lastSyncAttemptAt?: Date | null;
      lastSyncError?: string;
      admin: { status: TicketAdminStatus; assignee?: string; notes?: string; updatedAt: Date };
      createdAt: Date;
      updatedAt: Date;
    } | null>();
    return ticket ? hydrateLocalTicket(ticket) : null;
  }

  const state = await readState();
  const id = state.ticketsByEmailId[sourceEmailId];
  return id ? state.ticketsById[id] : null;
}

export async function listTickets(): Promise<LocalTicket[]> {
  if (isMongoConfigured()) {
    await connectMongo();
    const tickets = await LocalTicketRecordModel.find({})
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          localTicketId: string;
          peppermintTicketId?: string | null;
          sourceEmailId: string;
          channel?: "inbox" | "user_dashboard";
          sender?: string;
          requesterName?: string;
          subject?: string;
          details?: string;
          date?: string;
          risk: RiskSummary;
          decision: TicketDecision;
          confidence: number;
          syncState: TicketSyncState;
          lastSyncAttemptAt?: Date | null;
          lastSyncError?: string;
          admin: { status: TicketAdminStatus; assignee?: string; notes?: string; updatedAt: Date };
          createdAt: Date;
          updatedAt: Date;
        }>
      >();
    return tickets.map(hydrateLocalTicket);
  }

  const state = await readState();
  return Object.values(state.ticketsById).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateTicket(localTicketId: string, patch: Partial<LocalTicket>): Promise<LocalTicket> {
  if (isMongoConfigured()) {
    await connectMongo();
    const existing = await LocalTicketRecordModel.findOne({ localTicketId });
    if (!existing) throw new Error("Ticket not found");

    existing.peppermintTicketId = patch.peppermintTicketId ?? existing.peppermintTicketId;
    existing.channel = patch.channel ?? existing.channel;
    existing.sender = patch.sender ?? existing.sender;
    existing.requesterName = patch.requesterName ?? existing.requesterName;
    existing.subject = patch.subject ?? existing.subject;
    existing.details = patch.details ?? existing.details;
    existing.date = patch.date ?? existing.date;
    existing.risk = patch.risk ?? existing.risk;
    existing.decision = patch.decision ?? existing.decision;
    existing.confidence = patch.confidence ?? existing.confidence;
    existing.syncState = patch.syncState ?? existing.syncState;
    existing.lastSyncAttemptAt = patch.lastSyncAttemptAt ? new Date(patch.lastSyncAttemptAt) : existing.lastSyncAttemptAt;
    existing.lastSyncError = patch.lastSyncError ?? existing.lastSyncError;

    if (patch.admin) {
      existing.admin = {
        ...existing.admin,
        ...patch.admin,
        updatedAt: patch.admin.updatedAt ? new Date(patch.admin.updatedAt) : new Date(),
      };
    }

    await existing.save();

    return hydrateLocalTicket({
      localTicketId: existing.localTicketId,
      peppermintTicketId: existing.peppermintTicketId,
      sourceEmailId: existing.sourceEmailId,
      channel: existing.channel,
      sender: existing.sender,
      requesterName: existing.requesterName,
      subject: existing.subject,
      details: existing.details,
      date: existing.date,
      risk: existing.risk,
      decision: existing.decision,
      confidence: existing.confidence,
      syncState: existing.syncState,
      lastSyncAttemptAt: existing.lastSyncAttemptAt,
      lastSyncError: existing.lastSyncError,
      admin: {
        status: existing.admin.status,
        assignee: existing.admin.assignee,
        notes: existing.admin.notes,
        updatedAt: existing.admin.updatedAt,
      },
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });
  }

  const state = await readState();
  const existing = state.ticketsById[localTicketId];
  if (!existing) throw new Error("Ticket not found");

  const merged: LocalTicket = {
    ...existing,
    ...patch,
    admin: patch.admin
      ? {
          ...existing.admin,
          ...patch.admin,
          updatedAt: patch.admin.updatedAt || new Date().toISOString(),
        }
      : existing.admin,
    updatedAt: new Date().toISOString(),
  };

  state.ticketsById[localTicketId] = merged;
  await writeState(state);
  return merged;
}

export async function updateTicketAdmin(localTicketId: string, adminPatch: AdminPatch): Promise<LocalTicket> {
  if (isMongoConfigured()) {
    await connectMongo();
    const existing = await LocalTicketRecordModel.findOne({ localTicketId });
    if (!existing) throw new Error("Ticket not found");

    const updatedAt = new Date();
    existing.admin = {
      ...existing.admin,
      ...adminPatch,
      updatedAt,
    };
    await existing.save();

    const merged = hydrateLocalTicket({
      localTicketId: existing.localTicketId,
      peppermintTicketId: existing.peppermintTicketId,
      sourceEmailId: existing.sourceEmailId,
      channel: existing.channel,
      sender: existing.sender,
      requesterName: existing.requesterName,
      subject: existing.subject,
      details: existing.details,
      date: existing.date,
      risk: existing.risk,
      decision: existing.decision,
      confidence: existing.confidence,
      syncState: existing.syncState,
      lastSyncAttemptAt: existing.lastSyncAttemptAt,
      lastSyncError: existing.lastSyncError,
      admin: {
        status: existing.admin.status,
        assignee: existing.admin.assignee,
        notes: existing.admin.notes,
        updatedAt: existing.admin.updatedAt,
      },
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });

    await appendTicketAuditEvent({
      type: "ticket.admin.updated",
      at: merged.admin.updatedAt,
      localTicketId,
      status: merged.admin.status,
      assignee: merged.admin.assignee,
      notePreview: merged.admin.notes ? merged.admin.notes.slice(0, 160) : undefined,
    });

    return merged;
  }

  const state = await readState();
  const existing = state.ticketsById[localTicketId];
  if (!existing) throw new Error("Ticket not found");

  const updatedAt = new Date().toISOString();
  const nextAdmin: TicketAdminMeta = {
    ...existing.admin,
    ...adminPatch,
    updatedAt,
  };

  const merged: LocalTicket = {
    ...existing,
    admin: nextAdmin,
    updatedAt,
  };
  state.ticketsById[localTicketId] = merged;
  await writeState(state);

  await appendTicketAuditEvent({
    type: "ticket.admin.updated",
    at: updatedAt,
    localTicketId,
    status: nextAdmin.status,
    assignee: nextAdmin.assignee,
    notePreview: nextAdmin.notes ? nextAdmin.notes.slice(0, 160) : undefined,
  });

  return merged;
}

export async function listTicketsNeedingSync(): Promise<LocalTicket[]> {
  if (isMongoConfigured()) {
    await connectMongo();
    const tickets = await LocalTicketRecordModel.find({
      syncState: { $in: ["pending", "failed", "local_only"] },
    })
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          localTicketId: string;
          peppermintTicketId?: string | null;
          sourceEmailId: string;
          channel?: "inbox" | "user_dashboard";
          sender?: string;
          requesterName?: string;
          subject?: string;
          details?: string;
          date?: string;
          risk: RiskSummary;
          decision: TicketDecision;
          confidence: number;
          syncState: TicketSyncState;
          lastSyncAttemptAt?: Date | null;
          lastSyncError?: string;
          admin: { status: TicketAdminStatus; assignee?: string; notes?: string; updatedAt: Date };
          createdAt: Date;
          updatedAt: Date;
        }>
      >();
    return tickets.map(hydrateLocalTicket);
  }

  const all = await listTickets();
  return all.filter((ticket) =>
    ticket.syncState === "pending" || ticket.syncState === "failed" || ticket.syncState === "local_only"
  );
}
