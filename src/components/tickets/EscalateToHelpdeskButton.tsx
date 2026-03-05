"use client";

import { useState } from "react";
import type { RiskSummary, TicketDecision } from "@/lib/tickets/types";
import { useRouter } from "next/navigation";

type Props = {
  sourceEmailId: string;
  sender?: string;
  subject?: string;
  date?: string;
  risk: RiskSummary;
  decision: TicketDecision;
  confidence: number;
  onCreated?: (localTicketId: string) => void;
};

export function EscalateToHelpdeskButton(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: props.subject || `Escalation ${props.sourceEmailId}`,
          description: [
            `Source Email ID: ${props.sourceEmailId}`,
            props.sender ? `Sender: ${props.sender}` : "",
            props.date ? `Date: ${props.date}` : "",
            `Decision: ${props.decision} (${Math.round(props.confidence * 100)}% confidence)`,
            `Risk Category: ${props.risk.category}`,
            `Risk Score: ${props.risk.score}`,
            ...props.risk.deterministicNotes,
            props.risk.llmSummary ? `LLM Summary: ${props.risk.llmSummary}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          priority: props.risk.score >= 75 ? "high" : props.risk.score >= 45 ? "medium" : "low",
        }),
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

      if (json.ticket?._id) {
        props.onCreated?.(json.ticket._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold min-h-[40px] w-full sm:w-auto disabled:opacity-60"
      >
        {loading ? "Escalating..." : "Create Helpdesk Ticket"}
      </button>
      {error ? <div className="text-xs text-rose-300">{error}</div> : null}
    </div>
  );
}
