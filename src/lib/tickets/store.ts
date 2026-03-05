import crypto from "crypto";
import fs from "fs/promises";
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
  const state = await readState();
  return state.ticketsById[localTicketId] || null;
}

export async function getTicketByEmailId(sourceEmailId: string): Promise<LocalTicket | null> {
  const state = await readState();
  const id = state.ticketsByEmailId[sourceEmailId];
  return id ? state.ticketsById[id] : null;
}

export async function listTickets(): Promise<LocalTicket[]> {
  const state = await readState();
  return Object.values(state.ticketsById).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateTicket(localTicketId: string, patch: Partial<LocalTicket>): Promise<LocalTicket> {
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
  const all = await listTickets();
  return all.filter((ticket) =>
    ticket.syncState === "pending" || ticket.syncState === "failed" || ticket.syncState === "local_only"
  );
}
