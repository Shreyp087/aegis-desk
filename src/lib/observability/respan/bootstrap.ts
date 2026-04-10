import "server-only";

import { getRespanConfig, isRespanEnabled } from "./config";
import { initializeRespanTelemetry } from "./client";

export interface RespanBootstrapState {
  enabled: boolean;
  configured: boolean;
  active: boolean;
  gatewayEnabled: boolean;
  environment: string;
  serviceName: string;
}

export function getRespanBootstrapState(): RespanBootstrapState {
  const config = getRespanConfig();

  return {
    enabled: config.enabled,
    configured: config.configured,
    active: isRespanEnabled(config),
    gatewayEnabled: config.gatewayEnabled,
    environment: config.environment,
    serviceName: config.serviceName,
  };
}

export async function initializeRespan(): Promise<boolean> {
  const client = await initializeRespanTelemetry();
  return client !== null;
}

