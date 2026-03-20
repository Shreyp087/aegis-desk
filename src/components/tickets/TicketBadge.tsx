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
      ? "border-emerald-800/60 bg-emerald-950/50 text-emerald-400"
      : ticket.syncState === "failed"
        ? "border-red-800/60 bg-red-950/50 text-red-400"
        : "border-zinc-700/50 bg-zinc-800/50 text-zinc-300";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-mono font-medium tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

