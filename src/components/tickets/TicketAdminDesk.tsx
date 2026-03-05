"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketDto, TicketStatus } from "@/lib/ticketing/types";

type AdminProfile = {
  id: string;
  name: string;
  email: string;
  role: "admin";
};

function statusBadge(status: TicketStatus): string {
  if (status === "resolved") return "border-emerald-300/50 bg-emerald-500/10 text-emerald-200";
  if (status === "in_progress") return "border-cyan-300/50 bg-cyan-500/10 text-cyan-100";
  return "border-amber-300/50 bg-amber-500/10 text-amber-100";
}

export function TicketAdminDesk() {
  const router = useRouter();
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");

  const selected = useMemo(
    () => tickets.find((ticket) => ticket._id === selectedId) || null,
    [tickets, selectedId]
  );

  useEffect(() => {
    setResponseDraft(selected?.adminResponse || "");
  }, [selected?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      profile?: { id: string; name: string; email: string; role: "user" | "admin" };
    };
    if (!res.ok || !json.ok || !json.profile) {
      router.replace("/login/admin");
      return null;
    }
    if (json.profile.role !== "admin") {
      router.replace("/tickets/user");
      return null;
    }
    const adminProfile: AdminProfile = {
      id: json.profile.id,
      name: json.profile.name,
      email: json.profile.email,
      role: "admin",
    };
    setProfile(adminProfile);
    return adminProfile;
  }, [router]);

  const refreshTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/tickets/all${query}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; error?: string; tickets?: TicketDto[] };
      if (res.status === 401 || res.status === 403) {
        router.replace("/login/admin");
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
    let mounted = true;
    (async () => {
      const admin = await loadProfile();
      if (!mounted || !admin) return;
      await refreshTickets();
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [loadProfile, refreshTickets]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshTickets();
    }, 10000);
    return () => window.clearInterval(id);
  }, [refreshTickets]);

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login/admin");
    router.refresh();
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
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-slate-100">Admin Desk</div>
          <div className="text-xs text-slate-300">
            {profile ? `Signed in as ${profile.name} (${profile.email})` : "Verifying admin session..."}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refreshTickets()}
            className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="surface-card p-3 flex flex-wrap gap-2">
        <input
          className="field-input text-sm flex-1 min-w-[240px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, requester, assignee..."
        />
        <select
          className="field-input text-sm w-[180px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | TicketStatus)}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {loading ? <div className="text-sm text-slate-300">Loading admin desk...</div> : null}
      {error ? <div className="text-sm text-rose-300">{error}</div> : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-h-0">
        <div className="surface-card min-h-0 max-h-[420px] overflow-auto">
          {filtered.map((ticket) => (
            <button
              key={ticket._id}
              type="button"
              onClick={() => setSelectedId(ticket._id)}
              className={`w-full text-left p-3 border-b border-slate-500/25 ${
                selectedId === ticket._id ? "bg-cyan-400/15" : "hover:bg-cyan-400/10"
              }`}
            >
              <div className="text-sm font-semibold text-slate-100 truncate">{ticket.title}</div>
              <div className="text-xs text-slate-300 truncate">{ticket.createdBy.email}</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={`inline-flex px-2 py-1 rounded-full text-xs border ${statusBadge(ticket.status)}`}>
                  {ticket.status}
                </span>
                <span className="text-xs text-slate-300 uppercase">{ticket.priority}</span>
              </div>
            </button>
          ))}
          {!loading && filtered.length === 0 ? <div className="p-3 text-sm text-slate-300">No matching tickets.</div> : null}
        </div>

        <div className="surface-card p-3 lg:col-span-2">
          {!selected ? (
            <div className="text-sm text-slate-300">Select a ticket to manage.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-slate-300">
                <span className="font-semibold text-slate-100">{selected.title}</span> •{" "}
                <span className="panel-mono">{selected._id}</span>
              </div>
              <div className="text-xs text-slate-300">
                Requester: <b>{selected.createdBy.name || selected.createdBy.email}</b> ({selected.createdBy.email})
              </div>
              <div className="text-xs text-slate-300">
                Assigned: <b>{selected.assignedAdmin?.name || "Unassigned"}</b>
              </div>
              <div className="text-xs text-slate-200 whitespace-pre-wrap surface-subcard p-2">
                {selected.description}
              </div>

              <label className="text-xs text-slate-300">
                Admin response
                <textarea
                  className="field-input text-sm mt-1 min-h-[140px] resize-y"
                  value={responseDraft}
                  onChange={(e) => setResponseDraft(e.target.value)}
                  placeholder="Add troubleshooting steps, updates, or resolution notes..."
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void assignToSelf()}
                  disabled={saving}
                  className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  Assign to Me
                </button>
                <button
                  type="button"
                  onClick={() => void submitResponse()}
                  disabled={saving || responseDraft.trim().length === 0}
                  className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Send Response"}
                </button>
                <button
                  type="button"
                  onClick={() => void markResolved()}
                  disabled={saving}
                  className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                >
                  Mark Resolved
                </button>
                <Link href={`/tickets/${selected._id}`} className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline">
                  Open Ticket Detail
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
