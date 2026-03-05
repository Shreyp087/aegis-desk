import fs from "fs/promises";
import { getTicketsAuditLogPath, getTicketsDir } from "./paths";
import type { TicketAuditEvent } from "./types";

async function ensureTicketsDir() {
  await fs.mkdir(getTicketsDir(), { recursive: true });
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function appendTicketAuditEvent(event: TicketAuditEvent) {
  await ensureTicketsDir();
  const p = getTicketsAuditLogPath();
  await fs.appendFile(p, JSON.stringify(event) + "\n", "utf8");
}

export async function readTicketAuditLogTail(maxLines = 200): Promise<string[]> {
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
