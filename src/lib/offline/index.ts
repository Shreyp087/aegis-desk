export {
  OFFLINE_MODE_TEMPLATE,
  OFFLINE_MODE_TEMPLATE_CONFIG,
  OFFLINE_MODE_TEMPLATE_THRESHOLDS,
  OFFLINE_MODE_TEMPLATE_WEIGHTS,
} from "./template";
export { getOfflineRuntimeConfig, isOfflineEnforced } from "./runtime";

export type {
  DecisionAction,
  DecisionEvidence,
  EvidenceSource,
  OfflineDecisionTemplate,
  OfflineMailInput,
  OfflineModeConfig,
  OfflineModeState,
  ScamCategory,
  TrustedCategory,
  TrustedDecisionResult,
  TrustedDecisionSignalWeights,
  TrustedDecisionThresholds,
} from "./template";
