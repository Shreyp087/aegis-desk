"use client";

import type { LocalTicket } from "@/lib/tickets/types";

export function TicketBadge({ ticket }: { ticket: LocalTicket }) {
  const label =
    ticket.syncState === "synced"
      ? `Peppermint #${ticket.peppermintTicketId}`
      : ticket.syncState === "local_only"
        ? "Pending sync (offline)"
        : ticket.syncState === "pending"
          ? "Pending sync"
          : "Sync failed";

  const classes =
    ticket.syncState === "synced"
      ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
      : ticket.syncState === "failed"
        ? "border-rose-300/60 bg-rose-400/15 text-rose-100"
        : "border-slate-300/40 bg-slate-800/40 text-slate-100";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${classes}`}>
      {label}
    </span>
  );
}
