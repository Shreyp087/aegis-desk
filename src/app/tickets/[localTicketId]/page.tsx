import { isValidObjectId } from "mongoose";
import { redirect } from "next/navigation";
import DesktopShell from "@/components/DesktopShell";
import { StatusBadge } from "@/components/ui/AegisPrimitives";
import { getServerSession } from "@/lib/auth/session";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";

export const runtime = "nodejs";

function statusTone(status: "open" | "in_progress" | "resolved"): "risk" | "caution" | "clear" | "info" {
  if (status === "resolved") return "clear";
  if (status === "in_progress") return "info";
  return "caution";
}

function priorityTone(priority: "low" | "medium" | "high"): "risk" | "caution" | "clear" {
  if (priority === "high") return "risk";
  if (priority === "medium") return "caution";
  return "clear";
}

function DetailPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-aegis-border bg-aegis-surface p-4">
      <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">{label}</div>
      <div className="mt-3 text-sm leading-relaxed text-aegis-muted">{children}</div>
    </section>
  );
}

export default async function TicketDetailPage({ params }: { params: Promise<{ localTicketId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { localTicketId } = await params;
  if (!isValidObjectId(localTicketId)) {
    return (
      <DesktopShell>
        <div className="mx-auto w-full max-w-3xl rounded-xl border border-aegis-border bg-aegis-surface p-6 text-aegis-text">Invalid ticket ID</div>
      </DesktopShell>
    );
  }

  await connectMongo();
  const found = await TicketModel.findById(localTicketId).populate("createdBy", "name email").populate("assignedAdmin", "name email").lean();

  if (!found) {
    return (
      <DesktopShell>
        <div className="mx-auto w-full max-w-3xl rounded-xl border border-aegis-border bg-aegis-surface p-6 text-aegis-text">Ticket not found</div>
      </DesktopShell>
    );
  }

  const ticket = toTicketDto(found);
  if (session.role === "user" && ticket.createdBy._id !== session.id) redirect("/tickets/user");

  return (
    <DesktopShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-aegis-border bg-gradient-to-b from-aegis-surface to-aegis-base p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">Ticket Detail</div>
              <div className="mt-2 text-2xl font-medium text-aegis-text">{ticket.title}</div>
              <div className="mt-2 text-sm text-aegis-muted">Requested by {ticket.createdBy.name || ticket.createdBy.email} ({ticket.createdBy.email})</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={statusTone(ticket.status)}>{ticket.status}</StatusBadge>
              <StatusBadge tone={priorityTone(ticket.priority)}>{ticket.priority}</StatusBadge>
            </div>
          </div>
        </section>

        <DetailPanel label="Ticket ID"><span className="font-mono text-aegis-text break-all">{ticket._id}</span></DetailPanel>
        <DetailPanel label="Description"><span className="whitespace-pre-wrap text-aegis-text">{ticket.description}</span></DetailPanel>
        <DetailPanel label="Assigned Admin">{ticket.assignedAdmin?.name || ticket.assignedAdmin?.email || "Unassigned"}</DetailPanel>
        <DetailPanel label="Admin Response"><span className="whitespace-pre-wrap text-aegis-text">{ticket.adminResponse || "No response yet."}</span></DetailPanel>
        <DetailPanel label="Timeline">
          <div>Created: {new Date(ticket.createdAt).toLocaleString()}</div>
          <div>Updated: {new Date(ticket.updatedAt).toLocaleString()}</div>
          <div>Resolved: {ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : "Not resolved"}</div>
        </DetailPanel>
      </div>
    </DesktopShell>
  );
}
