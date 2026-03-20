"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import PanelFrame from "@/components/PanelFrame";
import { AegisButton, EmptyState, InlineError, MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import { useAuth } from "@/context/AuthContext";
import type { TicketDto, TicketStatus } from "@/lib/ticketing/types";

function statusTone(status: TicketStatus): "risk" | "caution" | "clear" | "info" {
  if (status === "resolved") return "clear";
  if (status === "in_progress") return "info";
  return "caution";
}

function priorityTone(priority: TicketDto["priority"]): "risk" | "caution" | "clear" {
  if (priority === "high") return "risk";
  if (priority === "medium") return "caution";
  return "clear";
}

export function TicketAdminDesk() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");

  const selected = useMemo(() => tickets.find((ticket) => ticket._id === selectedId) || null, [tickets, selectedId]);

  useEffect(() => {
    setResponseDraft(selected?.adminResponse || "");
  }, [selected?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/tickets/all${query}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; error?: string; tickets?: TicketDto[] };
      if (res.status === 401 || res.status === 403) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setTickets(json.tickets || []);
      if (!selectedId && json.tickets && json.tickets.length > 0) {
        setSelectedId(json.tickets[0]._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [router, selectedId, statusFilter]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/sign-in");
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (authLoading || !user || user.role !== "admin") return;
    void refreshTickets();
  }, [authLoading, refreshTickets, user]);

  useEffect(() => {
    if (authLoading || !user || user.role !== "admin") return;
    const id = window.setInterval(() => {
      void refreshTickets();
    }, 10000);
    return () => window.clearInterval(id);
  }, [authLoading, refreshTickets, user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((ticket) => {
      const haystack = `${ticket.title} ${ticket.createdBy.email} ${ticket.createdBy.name} ${
        ticket.assignedAdmin?.name || ""
      } ${ticket.status}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [tickets, search]);

  const summary = useMemo(
    () => ({
      total: tickets.length,
      open: tickets.filter((ticket) => ticket.status === "open").length,
      inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
      resolved: tickets.filter((ticket) => ticket.status === "resolved").length,
    }),
    [tickets]
  );

  if (authLoading || !user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
      </div>
    );
  }

  async function assignToSelf() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${selected._id}/assign`, { method: "PATCH" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function submitResponse() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${selected._id}/respond`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminResponse: responseDraft }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function markResolved() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${selected._id}/resolve`, { method: "PATCH" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refreshTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <section className="rounded-3xl border border-foreground/8 bg-surface/90 p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest opacity-40">Admin Operations</div>
            <h1 className="mt-3 text-2xl font-medium tracking-tight md:text-3xl">Ticket admin desk</h1>
            <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
              {`Signed in as ${user.name} (${user.email})`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Role · admin</StatusBadge>
            <AegisButton variant="secondary" onClick={() => void refreshTickets()}>
              Refresh
            </AegisButton>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total" value={summary.total} sub="Tickets in the current queue." />
        <MetricCard label="Open" value={summary.open} sub="Awaiting assignment or response." tone="caution" />
        <MetricCard label="In Progress" value={summary.inProgress} sub="Active operator work." tone="info" />
        <MetricCard label="Resolved" value={summary.resolved} sub="Closed incidents." tone="clear" />
      </section>

      <section className="rounded-3xl border border-foreground/8 bg-surface/90 p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <input
            className="aegis-input flex-1 min-w-0"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, requester, assignee, or status"
          />
          <select
            className="aegis-select lg:w-52"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | TicketStatus)}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        {error ? <InlineError className="mt-3" message={error} /> : null}
      </section>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <PanelFrame
          title="Queue"
          subtitle="Priority-driven ticket list"
          status={<StatusBadge tone={loading ? "caution" : "muted"}>{loading ? "Loading" : `${filtered.length} visible`}</StatusBadge>}
          className="min-h-[36rem]"
        >
          <div className="grid gap-2">
            {filtered.map((ticket, index) => (
              <button
                key={ticket._id}
                type="button"
                onClick={() => setSelectedId(ticket._id)}
                style={{ transitionDelay: `${index * 30}ms` }}
                className={[
                  "flex w-full items-start gap-3 rounded-2xl border border-transparent border-l-2 bg-background/70 p-4 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/10 hover:bg-surface",
                  selectedId === ticket._id ? "border-l-accent bg-surface shadow-sm" : "",
                  ticket.priority === "high"
                    ? "border-l-signal-risk"
                    : ticket.priority === "medium"
                      ? "border-l-signal-caution"
                      : "border-l-signal-info",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono uppercase tracking-widest opacity-40">{ticket._id}</div>
                  <div className="mt-2 truncate text-sm font-medium text-foreground">{ticket.title}</div>
                  <div className="mt-1 truncate text-sm text-foreground/60">{ticket.createdBy.email}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StatusBadge tone={statusTone(ticket.status)}>{ticket.status.replace("_", " ")}</StatusBadge>
                  <StatusBadge tone={priorityTone(ticket.priority)}>{ticket.priority}</StatusBadge>
                </div>
              </button>
            ))}
            {!loading && filtered.length === 0 ? (
              <EmptyState
                className="min-h-60"
                title="No matching tickets"
                description="Adjust the search or status filter to bring items back into the queue."
              />
            ) : null}
          </div>
        </PanelFrame>

        <PanelFrame
          title="Detail"
          subtitle="Assignment, response, and resolution"
          status={selected ? <StatusBadge tone={statusTone(selected.status)}>{selected.status.replace("_", " ")}</StatusBadge> : <StatusBadge tone="muted">No ticket selected</StatusBadge>}
          className="min-h-[36rem]"
        >
          {!selected ? (
            <EmptyState
              className="min-h-96"
              title="Select a ticket"
              description="Choose a queue item to assign ownership, write a response, or resolve it."
            />
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-mono uppercase tracking-widest opacity-40">Active Ticket</div>
                  <h2 className="mt-3 text-xl font-medium tracking-tight">{selected.title}</h2>
                  <p className="mt-2 text-sm font-light leading-relaxed text-foreground/60">
                    Requester: {selected.createdBy.name || selected.createdBy.email} ({selected.createdBy.email})
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={statusTone(selected.status)}>{selected.status.replace("_", " ")}</StatusBadge>
                  <StatusBadge tone={priorityTone(selected.priority)}>{selected.priority}</StatusBadge>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest opacity-40">Description</div>
                  <div className="mt-3 whitespace-pre-wrap text-sm font-light leading-relaxed text-foreground/80">
                    {selected.description}
                  </div>
                </div>

                <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest opacity-40">Assignment</div>
                  <div className="mt-3 grid gap-2 text-sm font-light leading-relaxed text-foreground/60">
                    <div>Assigned: {selected.assignedAdmin?.name || selected.assignedAdmin?.email || "Unassigned"}</div>
                    <div>Created: {new Date(selected.createdAt).toLocaleString()}</div>
                    <div>Updated: {new Date(selected.updatedAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-foreground/8 bg-background/70 p-4">
                <div className="text-xs font-mono uppercase tracking-widest opacity-40">Admin Response</div>
                <textarea
                  className="aegis-input aegis-textarea mt-3 min-h-44"
                  value={responseDraft}
                  onChange={(event) => setResponseDraft(event.target.value)}
                  placeholder="Add troubleshooting steps, updates, or resolution notes."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <AegisButton variant="secondary" onClick={() => void assignToSelf()} disabled={saving}>
                  Assign to Me
                </AegisButton>
                <AegisButton onClick={() => void submitResponse()} disabled={saving || responseDraft.trim().length === 0}>
                  {saving ? "Saving" : "Send Response"}
                </AegisButton>
                <AegisButton variant="ghost" onClick={() => void markResolved()} disabled={saving}>
                  Mark Resolved
                </AegisButton>
                <Link href={`/tickets/${selected._id}`} className="no-underline">
                  <AegisButton variant="ghost">Open Ticket Detail</AegisButton>
                </Link>
              </div>
            </div>
          )}
        </PanelFrame>
      </div>
    </div>
  );
}
