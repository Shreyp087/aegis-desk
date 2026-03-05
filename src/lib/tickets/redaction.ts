import type { LocalTicket } from "./types";

export function redactTicketForPeppermint(ticket: LocalTicket): Record<string, unknown> {
  return {
    sourceEmailId: ticket.sourceEmailId,
    channel: ticket.channel,
    sender: ticket.sender,
    requesterName: ticket.requesterName,
    subject: ticket.subject,
    details: ticket.details ? ticket.details.slice(0, 1200) : undefined,
    date: ticket.date,
    decision: ticket.decision,
    confidence: ticket.confidence,
    risk: {
      category: ticket.risk.category,
      score: ticket.risk.score,
      deterministicNotes: ticket.risk.deterministicNotes,
      llmSummary: ticket.risk.llmSummary,
    },
    localTicketId: ticket.localTicketId,
  };
}
