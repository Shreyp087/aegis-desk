import { isValidObjectId } from "mongoose";
import { redirect } from "next/navigation";
import DesktopShell from "@/components/DesktopShell";
import { getServerSession } from "@/lib/auth/session";
import { connectMongo } from "@/lib/db/mongoose";
import { TicketModel } from "@/lib/models/Ticket";
import { toTicketDto } from "@/lib/ticketing/serialize";

export const runtime = "nodejs";

function statusBadge(status: "open" | "in_progress" | "resolved"): string {
  if (status === "resolved") return "border-emerald-300/50 bg-emerald-500/10 text-emerald-200";
  if (status === "in_progress") return "border-cyan-300/50 bg-cyan-500/10 text-cyan-100";
  return "border-amber-300/50 bg-amber-500/10 text-amber-100";
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ localTicketId: string }>;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login/user");
  }

  const { localTicketId } = await params;
  if (!isValidObjectId(localTicketId)) {
    return (
      <DesktopShell>
        <div className="surface-card p-4">
          <div className="text-base font-semibold text-slate-100">Invalid ticket ID</div>
        </div>
      </DesktopShell>
    );
  }

  await connectMongo();
  const found = await TicketModel.findById(localTicketId)
    .populate("createdBy", "name email")
    .populate("assignedAdmin", "name email")
    .lean();

  if (!found) {
    return (
      <DesktopShell>
        <div className="surface-card p-4">
          <div className="text-base font-semibold text-slate-100">Ticket not found</div>
        </div>
      </DesktopShell>
    );
  }

  const ticket = toTicketDto(found);
  if (session.role === "user" && ticket.createdBy._id !== session.id) {
    redirect("/tickets/user");
  }

  return (
    <DesktopShell>
      <div className="flex flex-col gap-3">
        <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-100 truncate">{ticket.title}</div>
            <div className="text-xs text-slate-300">
              Requested by {ticket.createdBy.name || ticket.createdBy.email} ({ticket.createdBy.email})
            </div>
          </div>
          <span className={`inline-flex px-2 py-1 rounded-full text-xs border ${statusBadge(ticket.status)}`}>
            {ticket.status}
          </span>
        </div>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Ticket ID</div>
          <div className="panel-mono text-sm break-all">{ticket._id}</div>
        </section>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Priority</div>
          <div className="text-sm text-slate-100">{ticket.priority}</div>
        </section>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Description</div>
          <div className="text-xs text-slate-200 whitespace-pre-wrap">{ticket.description}</div>
        </section>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Assigned Admin</div>
          <div className="text-sm text-slate-100">
            {ticket.assignedAdmin?.name || ticket.assignedAdmin?.email || "Unassigned"}
          </div>
        </section>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Admin Response</div>
          <div className="text-xs text-slate-200 whitespace-pre-wrap">
            {ticket.adminResponse || "No response yet."}
          </div>
        </section>

        <section className="surface-card p-4">
          <div className="text-xs text-slate-300">Timeline</div>
          <div className="text-xs text-slate-200">
            Created: {new Date(ticket.createdAt).toLocaleString()}
          </div>
          <div className="text-xs text-slate-200">
            Updated: {new Date(ticket.updatedAt).toLocaleString()}
          </div>
          <div className="text-xs text-slate-200">
            Resolved: {ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString() : "Not resolved"}
          </div>
        </section>
      </div>
    </DesktopShell>
  );
}
