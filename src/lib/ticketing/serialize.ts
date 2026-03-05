import type { TicketDto } from "./types";

type PartyRef = {
  _id: { toString(): string } | string;
  name?: string;
  email?: string;
} | null;

type TicketLike = {
  _id: { toString(): string } | string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "medium" | "high";
  createdBy: PartyRef;
  assignedAdmin: PartyRef;
  adminResponse?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  resolvedAt?: Date | string | null;
};

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isObjectIdLike(value: unknown): value is { toString(): string } | string {
  return typeof value === "string" || (isObjectLike(value) && typeof value.toString === "function");
}

function isDateLike(value: unknown): value is Date | string {
  return typeof value === "string" || value instanceof Date;
}

function isTicketLike(value: unknown): value is TicketLike {
  if (!isObjectLike(value)) return false;

  const candidate = value as Partial<TicketLike>;
  const validStatus = candidate.status === "open" || candidate.status === "in_progress" || candidate.status === "resolved";
  const validPriority = candidate.priority === "low" || candidate.priority === "medium" || candidate.priority === "high";

  return (
    isObjectIdLike(candidate._id) &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    validStatus &&
    validPriority &&
    "createdBy" in candidate &&
    "assignedAdmin" in candidate &&
    isDateLike(candidate.createdAt) &&
    isDateLike(candidate.updatedAt)
  );
}

function mapParty(party: PartyRef): { _id: string; name: string; email: string } | null {
  if (!party) return null;
  return {
    _id: typeof party._id === "string" ? party._id : party._id.toString(),
    name: party.name || "",
    email: party.email || "",
  };
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

export function toTicketDto(ticketInput: unknown): TicketDto {
  const candidate = Array.isArray(ticketInput) ? ticketInput[0] : ticketInput;
  if (!isTicketLike(candidate)) {
    throw new Error("Ticket payload has unexpected shape");
  }

  const ticket = candidate;

  const createdBy = mapParty(ticket.createdBy);
  if (!createdBy) {
    throw new Error("Ticket is missing createdBy reference");
  }
  return {
    _id: typeof ticket._id === "string" ? ticket._id : ticket._id.toString(),
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    createdBy,
    assignedAdmin: mapParty(ticket.assignedAdmin),
    adminResponse: ticket.adminResponse || "",
    createdAt: asIso(ticket.createdAt) || new Date().toISOString(),
    updatedAt: asIso(ticket.updatedAt) || new Date().toISOString(),
    resolvedAt: asIso(ticket.resolvedAt),
  };
}
