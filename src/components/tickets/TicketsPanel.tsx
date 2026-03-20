"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LocalTicket } from "@/lib/tickets/types";
import { TicketBadge } from "./TicketBadge";

import { AegisButton, EmptyState, InlineError } from "@/components/ui/AegisPrimitives";

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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aegis-border bg-aegis-surface p-4">
        <div>
          <div className="text-sm font-medium text-aegis-text">Tickets</div>
          <div className="mt-1 text-xs text-aegis-muted">
            {pendingCount > 0 ? `${pendingCount} pending/local` : "All synced"}
            {policy?.offlineEnforced ? " · Offline enforced" : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tickets/user" className="no-underline">
            <AegisButton variant="secondary">Open User Dashboard</AegisButton>
          </Link>
          <Link href="/tickets/admin" className="no-underline">
            <AegisButton variant="secondary">Open Admin Desk</AegisButton>
          </Link>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing || Boolean(policy?.offlineEnforced)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-aegis-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-aegis-accent-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-accent/50 disabled:pointer-events-none disabled:opacity-50"
            title={policy?.offlineEnforced ? "Sync disabled while offline is enforced" : "Sync queued tickets now"}
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      {loading ? <div className="text-sm text-aegis-muted">Loading tickets...</div> : null}
      {error ? <InlineError message={error} /> : null}

      <div className="grid gap-3">
        {tickets.map((ticket) => (
          <Link
            key={ticket.localTicketId}
            href={`/tickets/${ticket.localTicketId}`}
            className="flex flex-col gap-2 rounded-xl border border-aegis-border bg-aegis-surface p-4 no-underline text-inherit transition-colors duration-150 hover:bg-aegis-elevated"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-medium text-aegis-text">{ticket.subject || "(No subject)"}</div>
              <TicketBadge ticket={ticket} />
            </div>
            <div className="text-xs leading-5 text-aegis-muted">
              {ticket.sender ? `From ${ticket.sender}` : "Unknown sender"} · Status{" "}
              <span className="font-medium text-aegis-text">
                {ticket.syncState !== "synced" ? "pending" : remoteStatusByLocalTicketId[ticket.localTicketId]?.status || "open"}
              </span>{" "}
              · Risk {ticket.risk.category} ({ticket.risk.score}) · Admin {ticket.admin.status}
            </div>
            <div className="font-mono text-xs text-aegis-dim">
              SourceEmailID: <span>{ticket.sourceEmailId}</span>
            </div>
            {ticket.lastSyncError ? (
              <div className="text-xs text-red-400">Last sync error: {ticket.lastSyncError}</div>
            ) : null}
          </Link>
        ))}

        {!loading && tickets.length === 0 ? (
          <EmptyState title="No tickets yet" description="Escalate from Inbox Scanner or raise a ticket manually." />
        ) : null}
      </div>
    </div>
  );
}

