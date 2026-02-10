export type LedgerEvent = {
  ts: string;          // ISO timestamp
  type: "plan" | "step_start" | "step_done" | "search" | "redaction" | "warning" | "output";
  stepId?: string;
  message: string;
  data?: Record<string, any>;
};

export function makeEvent(e: Omit<LedgerEvent, "ts">): LedgerEvent {
  return { ts: new Date().toISOString(), ...e };
}