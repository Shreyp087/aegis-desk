import { getOfflineRuntimeConfig, isOfflineEnforced } from "@/lib/offline";

export type OfflinePolicy = {
  offlineEnforced: boolean;
  allowOutboundNetwork: boolean;
  allowLlmSummary: boolean;
};

export function getOfflinePolicy(): OfflinePolicy {
  const offline = getOfflineRuntimeConfig();
  const offlineEnforced = isOfflineEnforced(offline);

  return {
    offlineEnforced,
    allowOutboundNetwork: !(offlineEnforced && offline.blockOutboundNetwork),
    allowLlmSummary: !offlineEnforced,
  };
}
