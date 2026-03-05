import { PolicyMode, QueuePolicy } from "./types";

export type QueueGuardPolicy = {
  policyVersion: string;
  stepUpL1Threshold: number;
  stepUpL2Threshold: number;
  throttleThreshold: number;
  blockThreshold: number;
  frictionCap: number;
  frictionCostL1: number;
  frictionCostL2: number;
  weights: {
    velocity: number;
    timingUniformity: number;
    replay: number;
    navAnomaly: number;
    multiTab: number;
    tokenReuse: number;
    uaFlip: number;
    challengeFailRate: number;
  };
};

export function policyForMode(mode: PolicyMode): QueueGuardPolicy {
  if (mode === "FAN_FIRST") {
    return {
      policyVersion: "qg-1.0-fan-first",
      stepUpL1Threshold: 35,
      stepUpL2Threshold: 60,
      throttleThreshold: 75,
      blockThreshold: 90,
      frictionCap: 100,
      frictionCostL1: 18,
      frictionCostL2: 35,
      weights: {
        velocity: 22,
        timingUniformity: 16,
        replay: 18,
        navAnomaly: 22,
        multiTab: 10,
        tokenReuse: 20,
        uaFlip: 8,
        challengeFailRate: 14,
      },
    };
  }

  if (mode === "STRICT") {
    return {
      policyVersion: "qg-1.0-strict",
      stepUpL1Threshold: 25,
      stepUpL2Threshold: 50,
      throttleThreshold: 65,
      blockThreshold: 80,
      frictionCap: 110,
      frictionCostL1: 20,
      frictionCostL2: 40,
      weights: {
        velocity: 24,
        timingUniformity: 18,
        replay: 20,
        navAnomaly: 22,
        multiTab: 12,
        tokenReuse: 22,
        uaFlip: 10,
        challengeFailRate: 18,
      },
    };
  }

  return {
    policyVersion: "qg-1.0-accessibility-first",
    stepUpL1Threshold: 40,
    stepUpL2Threshold: 70,
    throttleThreshold: 78,
    blockThreshold: 92,
    frictionCap: 100,
    frictionCostL1: 15,
    frictionCostL2: 28,
    weights: {
      velocity: 22,
      timingUniformity: 14,
      replay: 18,
      navAnomaly: 22,
      multiTab: 10,
      tokenReuse: 18,
      uaFlip: 8,
      challengeFailRate: 12,
    },
  };
}

// Legacy policy export kept for compatibility with existing API route implementation.
export const QUEUEGUARD_POLICY: QueuePolicy = {
  version: "queueguard-policy-v1",
  frictionCap: 100,
  challengeCost: {
    1: 18,
    2: 36,
  },
  thresholds: {
    stepUp: 45,
    throttle: 72,
    block: 90,
  },
  signalWeights: {
    velocity: 22,
    timing_entropy: 12,
    replay: 18,
    navigation: 16,
    multi_tab_burst: 10,
    session_integrity: 14,
    challenge_failure_rate: 8,
  },
};
