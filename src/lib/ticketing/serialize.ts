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

export function toTicketDto(ticket: TicketLike): TicketDto {
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
