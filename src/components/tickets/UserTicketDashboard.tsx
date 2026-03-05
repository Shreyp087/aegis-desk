"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TicketDto, TicketPriority } from "@/lib/ticketing/types";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: "user";
};

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

function statusBadge(status: TicketDto["status"]): string {
  if (status === "resolved") return "border-emerald-300/50 bg-emerald-500/10 text-emerald-200";
  if (status === "in_progress") return "border-cyan-300/50 bg-cyan-500/10 text-cyan-100";
  return "border-amber-300/50 bg-amber-500/10 text-amber-100";
}

export function UserTicketDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<CreateTicketPayload>(DEFAULT_FORM);
  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      profile?: { id: string; name: string; email: string; role: "user" | "admin" };
    };

    if (!res.ok || !json.ok || !json.profile) {
      router.replace("/login/user");
      return null;
    }
    if (json.profile.role !== "user") {
      router.replace("/tickets/admin");
      return null;
    }
    const userProfile: UserProfile = {
      id: json.profile.id,
      name: json.profile.name,
      email: json.profile.email,
      role: "user",
    };
    setProfile(userProfile);
    return userProfile;
  }, [router]);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/my-tickets", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; error?: string; tickets?: TicketDto[] };
      if (res.status === 401 || res.status === 403) {
        router.replace("/login/user");
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
    let mounted = true;
    (async () => {
      const userProfile = await loadProfile();
      if (!mounted || !userProfile) return;
      await loadTickets();
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [loadProfile, loadTickets]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadTickets();
    }, 10000);
    return () => window.clearInterval(id);
  }, [loadTickets]);

  const summary = useMemo(() => {
    const total = tickets.length;
    const resolved = tickets.filter((ticket) => ticket.status === "resolved").length;
    const open = total - resolved;
    return { total, resolved, open };
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
        router.replace("/login/user");
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login/user");
    router.refresh();
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-slate-100">User Dashboard</div>
          <div className="text-xs text-slate-300">
            {profile ? `Signed in as ${profile.name} (${profile.email})` : "Verifying session..."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold"
        >
          Logout
        </button>
      </div>

      <div className="surface-card p-4 flex flex-col gap-3">
        <div className="text-sm font-semibold text-slate-100">Raise a Ticket</div>
        <div className="grid grid-cols-1 gap-2">
          <label className="text-xs text-slate-300">
            Title
            <input
              className="field-input text-sm mt-1"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Short issue summary"
            />
          </label>
          <label className="text-xs text-slate-300">
            Priority
            <select
              className="field-input text-sm mt-1"
              value={form.priority}
              onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as TicketPriority }))}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="text-xs text-slate-300">
            Description
            <textarea
              className="field-input text-sm mt-1 min-h-[120px] resize-y"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Describe the issue, impact, and what you already tried."
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submitTicket()}
            disabled={creating}
            className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {creating ? "Submitting..." : "Raise Ticket"}
          </button>
          <button
            type="button"
            onClick={() => void loadTickets()}
            disabled={loadingTickets}
            className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {loadingTickets ? "Loading..." : "Refresh My Tickets"}
          </button>
        </div>
        {success ? <div className="text-xs text-emerald-300">{success}</div> : null}
        {error ? <div className="text-xs text-rose-300">{error}</div> : null}
      </div>

      <div className="surface-card p-4">
        <div className="text-sm text-slate-200">
          Total: <b>{summary.total}</b> • Open/In Progress: <b>{summary.open}</b> • Resolved: <b>{summary.resolved}</b>
        </div>
      </div>

      <div className="grid gap-3">
        {tickets.map((ticket) => (
          <Link
            key={ticket._id}
            href={`/tickets/${ticket._id}`}
            className="surface-card p-4 no-underline text-inherit flex flex-col gap-2 hover:bg-cyan-400/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100 truncate">{ticket.title}</div>
              <span className={`inline-flex px-2 py-1 rounded-full text-xs border ${statusBadge(ticket.status)}`}>
                {ticket.status}
              </span>
            </div>
            <div className="text-xs text-slate-300">
              Priority: <b>{ticket.priority}</b>
              {ticket.assignedAdmin?.name ? ` • Assigned: ${ticket.assignedAdmin.name}` : ""}
            </div>
            <div className="text-xs text-slate-200 whitespace-pre-wrap">{ticket.description}</div>
            {ticket.adminResponse ? (
              <div className="text-xs text-cyan-100 whitespace-pre-wrap surface-subcard p-2">
                Admin response: {ticket.adminResponse}
              </div>
            ) : (
              <div className="text-xs text-slate-400">No admin response yet.</div>
            )}
          </Link>
        ))}
        {!loadingTickets && tickets.length === 0 ? (
          <div className="text-sm text-slate-300">No tickets yet.</div>
        ) : null}
      </div>
    </div>
  );
}
