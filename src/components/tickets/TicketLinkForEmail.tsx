"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LocalTicket } from "@/lib/tickets/types";
import { TicketBadge } from "./TicketBadge";

export function TicketLinkForEmail({ sourceEmailId }: { sourceEmailId: string }) {
  const [ticket, setTicket] = useState<LocalTicket | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const res = await fetch(`/api/tickets/status?sourceEmailId=${encodeURIComponent(sourceEmailId)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; ticket?: LocalTicket | null };
      if (!canceled && res.ok && json?.ok) {
        setTicket(json.ticket || null);
      }
    })().catch(() => {});

    return () => {
      canceled = true;
    };
  }, [sourceEmailId]);

  if (!ticket) return null;

  return (
    <Link
      href={`/tickets/${ticket.localTicketId}`}
      className="inline-flex items-center gap-2 no-underline"
      title="Open related ticket"
    >
      <TicketBadge ticket={ticket} />
    </Link>
  );
}
