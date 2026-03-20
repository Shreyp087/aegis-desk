import fs from "fs/promises";
import { connectMongo, isMongoConfigured } from "@/lib/db/mongoose";
import { TicketAuditEventModel } from "@/lib/models/TicketAuditEvent";
import { getTicketsAuditLogPath, getTicketsDir } from "./paths";
import type { TicketAuditEvent } from "./types";

async function ensureTicketsDir() {
  await fs.mkdir(getTicketsDir(), { recursive: true });
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function appendTicketAuditEvent(event: TicketAuditEvent) {
  if (isMongoConfigured()) {
    await connectMongo();
    await TicketAuditEventModel.create({
      ...event,
      at: new Date(event.at),
      sourceEmailId: "sourceEmailId" in event ? event.sourceEmailId || "" : "",
      decision: "decision" in event ? event.decision || "" : "",
      confidence: "confidence" in event ? event.confidence ?? 0 : 0,
      syncState: "syncState" in event ? event.syncState || "" : "",
      status: "status" in event ? event.status || "" : "",
      assignee: "assignee" in event ? event.assignee || "" : "",
      notePreview: "notePreview" in event ? event.notePreview || "" : "",
      peppermintBaseUrl: "peppermintBaseUrl" in event ? event.peppermintBaseUrl || "" : "",
      peppermintEndpoint: "peppermintEndpoint" in event ? event.peppermintEndpoint || "" : "",
      payload: "payload" in event ? event.payload : undefined,
      peppermintTicketId: "peppermintTicketId" in event ? event.peppermintTicketId || "" : "",
      error: "error" in event ? event.error || "" : "",
    });
    return;
  }

  await ensureTicketsDir();
  const p = getTicketsAuditLogPath();
  await fs.appendFile(p, JSON.stringify(event) + "\n", "utf8");
}

export async function readTicketAuditLogTail(maxLines = 200): Promise<string[]> {
  if (isMongoConfigured()) {
    await connectMongo();
    const records = await TicketAuditEventModel.find({})
      .sort({ at: -1 })
      .limit(Math.max(1, maxLines))
      .lean<
        Array<
          Partial<TicketAuditEvent> & {
            type: string;
            at: Date;
          }
        >
      >();
    return records
      .reverse()
      .map((record) =>
        JSON.stringify({
          ...record,
          at: new Date(record.at).toISOString(),
        })
      );
  }

  const p = getTicketsAuditLogPath();
  try {
    const raw = await fs.readFile(p, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(Math.max(0, lines.length - maxLines));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }
}
