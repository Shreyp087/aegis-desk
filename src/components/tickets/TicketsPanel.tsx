"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LocalTicket } from "@/lib/tickets/types";
import { TicketBadge } from "./TicketBadge";

type ApiStatusResponse =
  | {
      ok: true;
      tickets: LocalTicket[];
      policy: { offlineEnforced: boolean; allowOutboundNetwork: boolean };
      remoteStatusByLocalTicketId?: Record<string, { status: string }>;
    }
  | {
      ok: false;
      error: string;
    };

export function TicketsPanel() {
  const [tickets, setTickets] = useState<LocalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [policy, setPolicy] = useState<{ offlineEnforced: boolean; allowOutboundNetwork: boolean } | null>(null);
  const [remoteStatusByLocalTicketId, setRemoteStatusByLocalTicketId] = useState<Record<string, { status: string }>>(
    {}
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/status?all=1&includeRemote=1", { cache: "no-store" });
      const json = (await res.json()) as ApiStatusResponse;
      if (!res.ok || !json.ok) {
        throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      }
      setTickets(json.tickets);
      setPolicy(json.policy);
      setRemoteStatusByLocalTicketId(json.remoteStatusByLocalTicketId || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/sync", { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const pendingCount = useMemo(
    () => tickets.filter((t) => t.syncState !== "synced").length,
    [tickets]
  );

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="surface-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-100">Tickets</div>
          <div className="text-xs text-slate-300">
            {pendingCount > 0 ? `${pendingCount} pending/local` : "All synced"}
            {policy?.offlineEnforced ? " • Offline enforced" : ""}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/tickets/user" className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold">
            Open User Dashboard
          </Link>
          <Link href="/tickets/admin" className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold">
            Open Admin Desk
          </Link>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing || Boolean(policy?.offlineEnforced)}
            className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            title={policy?.offlineEnforced ? "Sync disabled while offline is enforced" : "Sync queued tickets now"}
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      {loading ? <div className="text-sm text-slate-300">Loading tickets...</div> : null}
      {error ? <div className="text-sm text-rose-300">{error}</div> : null}

      <div className="grid gap-3">
        {tickets.map((ticket) => (
          <Link
            key={ticket.localTicketId}
            href={`/tickets/${ticket.localTicketId}`}
            className="surface-card p-4 no-underline text-inherit flex flex-col gap-2 hover:bg-cyan-400/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100 truncate">{ticket.subject || "(No subject)"}</div>
              <TicketBadge ticket={ticket} />
            </div>
            <div className="text-xs text-slate-300 break-all">
              {ticket.sender ? `From ${ticket.sender}` : "Unknown sender"} • Status{" "}
              <b>{ticket.syncState !== "synced" ? "pending" : remoteStatusByLocalTicketId[ticket.localTicketId]?.status || "open"}</b> •
              Risk {ticket.risk.category} ({ticket.risk.score}) • Admin {ticket.admin.status}
            </div>
            <div className="text-xs text-slate-400">
              SourceEmailID: <span className="panel-mono">{ticket.sourceEmailId}</span>
            </div>
            {ticket.lastSyncError ? (
              <div className="text-xs text-rose-300">Last sync error: {ticket.lastSyncError}</div>
            ) : null}
          </Link>
        ))}

        {!loading && tickets.length === 0 ? <div className="text-sm text-slate-300">No tickets yet.</div> : null}
      </div>
    </div>
  );
}
