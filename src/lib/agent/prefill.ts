export const AGENT_ESCALATION_PREFILL_KEY = "aegis:agent-escalation-prefill:v1";

export type AgentEscalationPrefill = {
  rawEmail: string;
  command: string;
  source: "inbox-scanner";
  createdAt: number;
};

const PREFILL_REMOUNT_GRACE_MS = 2_000;

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

export function readAgentEscalationPrefill(maxAgeMs = 15 * 60 * 1000): AgentEscalationPrefill | null {
  if (typeof window === "undefined") return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(AGENT_ESCALATION_PREFILL_KEY);
    if (!raw) return null;

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
      clearAgentEscalationPrefill();
      return null;
    }

    const consumedAt =
      typeof (parsed as { consumedAt?: unknown }).consumedAt === "number"
        ? ((parsed as { consumedAt?: number }).consumedAt as number)
        : null;

    if (consumedAt && Date.now() - consumedAt > PREFILL_REMOUNT_GRACE_MS) {
      clearAgentEscalationPrefill();
      return null;
    }

    if (!consumedAt) {
      window.sessionStorage.setItem(
        AGENT_ESCALATION_PREFILL_KEY,
        JSON.stringify({
          ...parsed,
          consumedAt: Date.now(),
        })
      );
    }

    return parsed as AgentEscalationPrefill;
  } catch {
    if (raw !== null) {
      clearAgentEscalationPrefill();
    }
    return null;
  }
}

export function clearAgentEscalationPrefill() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(AGENT_ESCALATION_PREFILL_KEY);
  } catch {
    // Ignore storage failures.
  }
}
