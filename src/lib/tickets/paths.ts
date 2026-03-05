import path from "path";

export function getAegisDataDir(): string {
  return process.env.AEGIS_DATA_DIR || path.join(process.cwd(), "data");
}

export function getTicketsDir(): string {
  return path.join(getAegisDataDir(), "tickets");
}

export function getTicketsStatePath(): string {
  return path.join(getTicketsDir(), "tickets.state.json");
}

export function getTicketsAuditLogPath(): string {
  return path.join(getTicketsDir(), "tickets.audit.jsonl");
}
