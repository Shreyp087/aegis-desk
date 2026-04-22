import type { SessionStore } from "./sessionStore.types";

export type SilenceBreakSignal = {
  detected: boolean;
  gapHours: number;
  expectedGapHours: number;
  deviationFactor: number;
  urgencyBoost: number;
  confidence: number;
  rationale: string;
};

export type UnresolvedThreadSignal = {
  detected: boolean;
  threadKeyHash: string;
  priorRecordCount: number;
  earliestHoursAgo: number;
  priorMaxBand: "high" | "medium" | "low" | null;
  priorMaxAction: string | null;
  urgencyBoost: number;
  routingOverride: "escalate" | "human_review" | null;
  rationale: string;
};

export type ConvergingSignalSignal = {
  detected: boolean;
  clusterKey: string;
  distinctDomains: number;
  signalStrength: number;
  urgencyBoost: number;
  threatElevation: number;
  campaignType: "coordinated_attack" | "legitimate_convergence" | "ambiguous";
  rationale: string;
};

export type TemporalContextResult = {
  silenceBreak: SilenceBreakSignal;
  unresolvedThread: UnresolvedThreadSignal;
  convergingSignal: ConvergingSignalSignal;
  totalUrgencyDelta: number;
  totalThreatDelta: number;
  routingOverride: "escalate" | "human_review" | null;
  temporalFlags: string[];
};

export type TemporalContextInput = {
  senderDomainHash: string;
  threadKeyHash: string;
  clusterKey: string;
  receivedAt: number;
  decisionProfile: {
    threat: number;
    urgency: number;
    primaryCategory: string;
    attentionType: string;
  };
  trust: {
    senderScore: number;
    seen: number;
  };
  store: SessionStore;
};
