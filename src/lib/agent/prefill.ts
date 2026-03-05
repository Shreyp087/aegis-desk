export const AGENT_ESCALATION_PREFILL_KEY = "aegis:agent-escalation-prefill:v1";

export type AgentEscalationPrefill = {
  rawEmail: string;
  command: string;
  source: "inbox-scanner";
  createdAt: number;
};

export function stashAgentEscalationPrefill(input: { rawEmail: string; command: string }) {
  if (typeof window === "undefined") return;

  const payload: AgentEscalationPrefill = {
    rawEmail: input.rawEmail,
    command: input.command,
    source: "inbox-scanner",
    createdAt: Date.now(),
  };

  try {
    window.sessionStorage.setItem(AGENT_ESCALATION_PREFILL_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures (private mode / quota). Navigation still works.
  }
}

export function consumeAgentEscalationPrefill(maxAgeMs = 15 * 60 * 1000): AgentEscalationPrefill | null {
  if (typeof window === "undefined") return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(AGENT_ESCALATION_PREFILL_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(AGENT_ESCALATION_PREFILL_KEY);

    const parsed = JSON.parse(raw) as Partial<AgentEscalationPrefill>;
    if (
      typeof parsed.rawEmail !== "string" ||
      typeof parsed.command !== "string" ||
      parsed.source !== "inbox-scanner" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }

    if (Date.now() - parsed.createdAt > maxAgeMs) {
      return null;
    }

    return parsed as AgentEscalationPrefill;
  } catch {
    if (raw !== null) {
      try {
        window.sessionStorage.removeItem(AGENT_ESCALATION_PREFILL_KEY);
      } catch {
        // Ignore.
      }
    }
    return null;
  }
}
