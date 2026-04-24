import type { ClusterKey, SessionStore } from "./sessionStore.types";

export type SilenceBreakSignal = {
  detected: boolean;
  source: "intra_batch" | "cross_session" | null;
  gapHours: number;
  expectedGapHours: number;
  deviationFactor: number;
  priorCadenceSamples: number;
  novelSubjectPattern: boolean;
  urgencyBoost: number;
  confidence: number;
  rationale: string;
};

export type UnresolvedThreadSignal = {
  detected: boolean;
  threadKeyHash: string;
  priorScoredCount: number;
  actionablePriorCount: number;
  hoursApart: number;
  priorMaxBand: "high" | "medium" | "low" | null;
  priorMaxAction: string | null;
  novelSubjectPattern: boolean;
  urgencyBoost: number;
  routingOverride: "escalate" | "human_review" | null;
  rationale: string;
};

export type ConvergingSignalSignal = {
  detected: boolean;
  clusterKey: ClusterKey;
  distinctDomains: number;
  matchedRecordCount: number;
  matchingSubjectDomains: number;
  windowSpanHours: number;
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
  dominantTemporalSignal: "silence_break" | "unresolved_thread" | "converging_signal" | null;
  explanationNotes: string[];
};

export type TemporalContextInput = {
  senderDomainHash: string;
  threadKeyHash: string;
  clusterKey: ClusterKey;
  subjectPatternHash: string;
  receivedAt: number;
  trustGraph: {
    senderScore: number;
    seen: number;
    lastSeen: Date | null;
  };
  decisionProfile: {
    threat: number;
    urgency: number;
    primaryCategory: string;
    attentionType: string;
  };
  currentPriority?: {
    priorityScore: number;
    priorityBand: "high" | "medium" | "low";
  };
  store: SessionStore;
};
