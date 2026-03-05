export type QueueAction = "JOIN" | "REFRESH" | "CHECKOUT";

export type DecisionAction = "ALLOW" | "STEP_UP" | "THROTTLE" | "BLOCK";

export type StepUpLevel = 0 | 1 | 2;

export type StepUpMethod = "NONE" | "HOLD_TO_CONFIRM" | "OTP";

export type PolicyMode = "FAN_FIRST" | "STRICT" | "ACCESSIBILITY_FIRST";

export type Factor = {
  key: string;
  label: string;
  weight: number;
  score01: number;
  points: number;
  evidence: string;
};

export type RiskDecision = {
  risk: number;
  action: DecisionAction;
  stepUpLevel: StepUpLevel;
  stepUpMethod: StepUpMethod;
  factors: Factor[];
  latencyMs: number;
  notes: string[];
  friction: {
    cap: number;
    used: number;
    remaining: number;
  };
};

export type SessionEvent = {
  id: string;
  ts: number;
  action: QueueAction;
  meta?: {
    multiTab?: boolean;
    tokenReuse?: boolean;
    uaFlip?: boolean;
  };
};

export type SessionState = {
  sessionId: string;
  policyVersion: string;
  mode: PolicyMode;
  joined: boolean;
  lastDecision?: RiskDecision;
  frictionUsed: number;
  frictionCap: number;
  events: SessionEvent[];
  seenSequenceHashes: Record<string, number>;
  failedChallenges: number;
  passedChallenges: number;
};

export type LedgerEntry = {
  ts: number;
  sessionId: string;
  actionAttempted: QueueAction;
  decisionAction: DecisionAction;
  risk: number;
  stepUpLevel: StepUpLevel;
  stepUpMethod: StepUpMethod;
  topFactors: Array<{ key: string; points: number }>;
  frictionUsed: number;
  frictionCap: number;
  policyVersion: string;
  mode: PolicyMode;
  outcome: "ALLOWED" | "CHALLENGE_PASSED" | "CHALLENGE_FAILED" | "BLOCKED" | "THROTTLED";
  prevHash?: string;
  entryHash?: string;
};

// Legacy server-side QueueGuard types kept for compatibility with existing API routes.
export type QueueEventType = "join_queue" | "checkout" | "refresh";

export type QueueDecisionAction = "ALLOW" | "STEP_UP" | "THROTTLE" | "BLOCK";

export type QueueSignalSnapshot = {
  clientTs?: number;
  timingIntervalMs?: number;
  payloadHash?: string;
  sequenceFingerprint?: string;
  multiTabBurst?: boolean;
  tokenReuse?: boolean;
  uaFlip?: boolean;
};

export type RiskFactor = {
  key:
    | "velocity"
    | "timing_entropy"
    | "replay"
    | "navigation"
    | "multi_tab_burst"
    | "session_integrity"
    | "challenge_failure_rate";
  label: string;
  weight: number;
  score: number;
  contribution: number;
  evidence: string;
};

export type FrictionBudget = {
  cap: number;
  used: number;
  remaining: number;
};

export type QueueDecision = {
  risk: number;
  factors: RiskFactor[];
  topFactors: RiskFactor[];
  action: QueueDecisionAction;
  stepUpLevel: StepUpLevel;
  frictionBudget: FrictionBudget;
  policyVersion: string;
};

export type StepUpChallenge = {
  challengeId: string;
  level: StepUpLevel;
  kind: "hold" | "otp";
  holdDurationMs?: number;
  otpForDemo?: string;
  expiresAt?: string;
};

export type QueueLedgerEntry = {
  id: string;
  ts: string;
  sessionId: string;
  eventKind: "score" | "verify";
  eventType: QueueEventType;
  attemptedAction: QueueEventType;
  decisionAction: QueueDecisionAction;
  risk: number;
  topFactorKeys: string[];
  stepUpLevel: StepUpLevel;
  stepUpOutcome: "none" | "issued" | "pass" | "fail";
  policyVersion: string;
  frictionBudget: FrictionBudget;
  latencyMs: number;
  prevHash: string;
  entryHash: string;
};

export type QueueSessionState = {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  trustedUntil?: number;
  frictionUsed: number;
  challengeAttempts: number;
  challengePasses: number;
  challengeFailures: number;
  pendingChallenge?: {
    challengeId: string;
    level: StepUpLevel;
    kind: "hold" | "otp";
    issuedAt: number;
    expiresAt?: number;
    otpCode?: string;
  };
  lastDecision?: QueueDecision;
  lastEventType?: QueueEventType;
  history: Array<{
    ts: number;
    eventType: QueueEventType;
    payloadHash: string;
    sequenceFingerprint: string;
  }>;
  payloadCounts: Record<string, number>;
  sequenceCounts: Record<string, number>;
};

export type QueuePolicy = {
  version: string;
  frictionCap: number;
  challengeCost: {
    1: number;
    2: number;
  };
  thresholds: {
    stepUp: number;
    throttle: number;
    block: number;
  };
  signalWeights: Record<RiskFactor["key"], number>;
};

export type QueueScoreInput = {
  sessionId: string;
  eventType: QueueEventType;
  signalsSnapshot: QueueSignalSnapshot;
};

export type QueueVerifyInput = {
  sessionId: string;
  challengeId: string;
  method: "hold" | "otp";
  holdDurationMs?: number;
  otp?: string;
};

export type QueueScoreResponse = {
  ok: true;
  sessionId: string;
  eventType: QueueEventType;
  decision: QueueDecision;
  challenge?: StepUpChallenge;
  latencyMs: number;
};

export type QueueVerifyResponse = {
  ok: true;
  sessionId: string;
  verified: boolean;
  decision: QueueDecision;
  challenge?: StepUpChallenge;
  reason: string;
  latencyMs: number;
};
