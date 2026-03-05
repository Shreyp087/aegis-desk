import { appendTicketAuditEvent } from "./audit";
import { getPeppermintConfigFromEnv } from "./config";
import { getOfflinePolicy } from "./offlinePolicy";
import {
  buildPeppermintTicketBodyFromLocal,
  createPeppermintTicket,
} from "./peppermintClient";
import { redactTicketForPeppermint } from "./redaction";
import { listTicketsNeedingSync, updateTicket } from "./store";

export type SyncRunResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedOffline: boolean;
  skippedNotConfigured: boolean;
};

export async function syncQueuedTicketsOnce(): Promise<SyncRunResult> {
  const policy = getOfflinePolicy();
  if (!policy.allowOutboundNetwork) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skippedOffline: true,
      skippedNotConfigured: false,
    };
  }

  const cfg = getPeppermintConfigFromEnv();
  if (!cfg) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skippedOffline: false,
      skippedNotConfigured: true,
    };
  }

  const queue = await listTicketsNeedingSync();
  let succeeded = 0;
  let failed = 0;

  for (const ticket of queue) {
    const now = new Date().toISOString();
    await appendTicketAuditEvent({
      type: "ticket.sync.attempt",
      at: now,
      localTicketId: ticket.localTicketId,
      peppermintBaseUrl: cfg.baseUrl,
    });

    try {
      const redacted = redactTicketForPeppermint(ticket);
      const body = buildPeppermintTicketBodyFromLocal(redacted, ticket);

      await appendTicketAuditEvent({
        type: "ticket.sync.sent",
        at: new Date().toISOString(),
        localTicketId: ticket.localTicketId,
        peppermintBaseUrl: cfg.baseUrl,
        peppermintEndpoint:
          cfg.authMode === "public" ? "/api/v1/ticket/public/create" : "/api/v1/ticket/create",
        payload: body,
      });

      const created = await createPeppermintTicket(cfg, body, {
        allowOutboundNetwork: policy.allowOutboundNetwork,
      });

      await updateTicket(ticket.localTicketId, {
        peppermintTicketId: created.peppermintTicketId,
        syncState: "synced",
        lastSyncAttemptAt: now,
        lastSyncError: undefined,
      });

      await appendTicketAuditEvent({
        type: "ticket.sync.success",
        at: new Date().toISOString(),
        localTicketId: ticket.localTicketId,
        peppermintTicketId: created.peppermintTicketId,
      });
      succeeded += 1;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await updateTicket(ticket.localTicketId, {
        syncState: "failed",
        lastSyncAttemptAt: now,
        lastSyncError: err,
      });
      await appendTicketAuditEvent({
        type: "ticket.sync.failed",
        at: new Date().toISOString(),
        localTicketId: ticket.localTicketId,
        error: err,
      });
      failed += 1;
    }
  }

  return {
    attempted: queue.length,
    succeeded,
    failed,
    skippedOffline: false,
    skippedNotConfigured: false,
  };
}
