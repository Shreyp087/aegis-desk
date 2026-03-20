"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import PanelFrame from "@/components/PanelFrame";
import { AegisButton, EmptyState, InlineError, MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import { useAuth } from "@/context/AuthContext";
import type { TicketDto, TicketPriority } from "@/lib/ticketing/types";

type CreateTicketPayload = {
  title: string;
  description: string;
  priority: TicketPriority;
};

const DEFAULT_FORM: CreateTicketPayload = {
  title: "",
  description: "",
  priority: "medium",
};

function statusTone(status: TicketDto["status"]): "risk" | "caution" | "clear" | "info" {
  if (status === "resolved") return "clear";
  if (status === "in_progress") return "info";
  return "caution";
}

function priorityTone(priority: TicketPriority): "risk" | "caution" | "clear" {
  if (priority === "high") return "risk";
  if (priority === "medium") return "caution";
  return "clear";
}

function formatAge(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "--";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `${Math.max(minutes, 1)}m`;
}

export function UserTicketDashboard() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [form, setForm] = useState<CreateTicketPayload>(DEFAULT_FORM);
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/my-tickets", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; error?: string; tickets?: TicketDto[] };
      if (res.status === 401 || res.status === 403) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setTickets(json.tickets || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTickets(false);
    }
  }, [router]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (loading || !user || user.role !== "user") return;
    void loadTickets();
  }, [loadTickets, loading, user]);

  useEffect(() => {
    if (loading || !user || user.role !== "user") return;
    const id = window.setInterval(() => {
      void loadTickets();
    }, 10000);
    return () => window.clearInterval(id);
  }, [loadTickets, loading, user]);

  const summary = useMemo(() => {
    const total = tickets.length;
    const resolved = tickets.filter((ticket) => ticket.status === "resolved").length;
    const open = tickets.filter((ticket) => ticket.status === "open").length;
    const inProgress = tickets.filter((ticket) => ticket.status === "in_progress").length;
    const escalated = tickets.filter((ticket) => ticket.priority === "high").length;
    return { total, resolved, open, inProgress, escalated };
  }, [tickets]);

  async function submitTicket() {
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        ticket?: { _id?: string };
      };
      if (res.status === 401 || res.status === 403) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setSuccess(json.ticket?._id ? `Ticket created: ${json.ticket._id}` : "Ticket created.");
      await loadTickets();
      setForm(DEFAULT_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  if (loading || !user || user.role !== "user") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <section className="rounded-3xl border border-foreground/8 bg-surface/90 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl min-w-0">
              <div className="text-xs font-mono uppercase tracking-widest opacity-40">Ticket Follow-Through</div>
              <h1 className="mt-3 text-2xl font-medium tracking-tight md:text-3xl">User ticket dashboard</h1>
              <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
                {`Signed in as ${user.name} (${user.email})`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Role · user</StatusBadge>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total" value={summary.total} sub="All current tickets." />
            <MetricCard label="Open" value={summary.open} sub="Awaiting first response." tone="caution" />
            <MetricCard label="Escalated" value={summary.escalated} sub="High-priority tickets." tone="risk" />
            <MetricCard label="Resolved" value={summary.resolved} sub="Closed tickets." tone="clear" />
          </div>
        </div>
      </section>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <PanelFrame
          title="Raise Ticket"
          subtitle="Create a follow-through item"
          status={<StatusBadge tone="info">Self-service</StatusBadge>}
          className="min-h-[32rem]"
        >
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs font-mono uppercase tracking-widest opacity-40">Title</span>
              <input
                className="aegis-input"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Short issue summary"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-mono uppercase tracking-widest opacity-40">Priority</span>
              <select
                className="aegis-select"
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as TicketPriority }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-mono uppercase tracking-widest opacity-40">Description</span>
              <textarea
                className="aegis-input aegis-textarea min-h-44"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe the issue, impact, and what has already been tried."
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <AegisButton onClick={() => void submitTicket()} disabled={creating}>
                {creating ? "Submitting" : "Raise Ticket"}
              </AegisButton>
              <AegisButton variant="secondary" onClick={() => void loadTickets()} disabled={loadingTickets}>
                {loadingTickets ? "Refreshing" : "Refresh My Tickets"}
              </AegisButton>
            </div>
            {success ? <div className="text-sm text-signal-clear">{success}</div> : null}
            {error ? <InlineError message={error} /> : null}
          </div>
        </PanelFrame>

        <PanelFrame
          title="My Queue"
          subtitle="Tracked escalations and updates"
          status={<StatusBadge tone={loadingTickets ? "caution" : "muted"}>{loadingTickets ? "Refreshing" : `${tickets.length} tickets`}</StatusBadge>}
          className="min-h-[32rem]"
        >
          <div className="grid gap-3">
            {tickets.map((ticket, index) => (
              <Link
                key={ticket._id}
                href={`/tickets/${ticket._id}`}
                style={{ transitionDelay: `${index * 45}ms` }}
                className={[
                  "group rounded-2xl border border-foreground/8 bg-background/70 p-4 no-underline transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/15 hover:bg-surface",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono uppercase tracking-widest opacity-40">{ticket._id}</div>
                    <div className="mt-2 truncate text-sm font-medium text-foreground">{ticket.title}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <StatusBadge tone={statusTone(ticket.status)}>{ticket.status.replace("_", " ")}</StatusBadge>
                    <StatusBadge tone={priorityTone(ticket.priority)}>{ticket.priority}</StatusBadge>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-sm font-light leading-relaxed text-foreground/60 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0 whitespace-pre-wrap">{ticket.description}</div>
                  <div className="grid justify-start gap-1 text-xs md:justify-items-end">
                    <div className="font-mono tabular-nums opacity-50">{formatAge(ticket.createdAt)}</div>
                    <div className="text-foreground/60">
                      {ticket.assignedAdmin?.name ? `Assigned · ${ticket.assignedAdmin.name}` : "Unassigned"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-foreground/60">
                  {ticket.adminResponse ? `Admin response: ${ticket.adminResponse}` : "No admin response yet."}
                </div>
              </Link>
            ))}

            {!loadingTickets && tickets.length === 0 ? (
              <EmptyState
                title="No tickets yet"
                description="Escalate from Inbox Scanner or raise a ticket manually from the composer on this page."
              />
            ) : null}
          </div>
        </PanelFrame>
      </div>
    </div>
  );
}
