export type TicketDecision = "escalate" | "quarantine";

export type TicketSyncState = "local_only" | "pending" | "synced" | "failed";

export type RiskSummary = {
  category: string;
  score: number;
  deterministicNotes: string[];
  llmSummary?: string;
};

export type TicketAdminStatus = "new" | "triaged" | "in_progress" | "resolved" | "closed";

export type TicketAdminMeta = {
  status: TicketAdminStatus;
  assignee?: string;
  notes?: string;
  updatedAt: string;
};

export type LocalTicket = {
  localTicketId: string;
  peppermintTicketId: string | null;
  sourceEmailId: string;
  channel?: "inbox" | "user_dashboard";
  sender?: string;
  requesterName?: string;
  subject?: string;
  details?: string;
  date?: string;
  risk: RiskSummary;
  decision: TicketDecision;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  syncState: TicketSyncState;
  lastSyncAttemptAt?: string;
  lastSyncError?: string;
  admin: TicketAdminMeta;
};

export type TicketAuditEvent =
  | {
      type: "ticket.created";
      at: string;
      localTicketId: string;
      sourceEmailId: string;
      decision: TicketDecision;
      confidence: number;
      syncState: TicketSyncState;
    }
  | {
      type: "ticket.admin.updated";
      at: string;
      localTicketId: string;
      status: TicketAdminStatus;
      assignee?: string;
      notePreview?: string;
    }
  | {
      type: "ticket.sync.attempt";
      at: string;
      localTicketId: string;
      peppermintBaseUrl: string;
    }
  | {
      type: "ticket.sync.sent";
      at: string;
      localTicketId: string;
      peppermintBaseUrl: string;
      peppermintEndpoint: string;
      payload: unknown;
    }
  | {
      type: "ticket.sync.success";
      at: string;
      localTicketId: string;
      peppermintTicketId: string;
    }
  | {
      type: "ticket.sync.failed";
      at: string;
      localTicketId: string;
      error: string;
    };
