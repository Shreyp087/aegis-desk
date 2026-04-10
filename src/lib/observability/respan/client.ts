import "server-only";

import { RespanTelemetry } from "@respan/tracing";

import { getRespanTracingOptions } from "./config";

let telemetryClient: RespanTelemetry | null = null;
let initializationPromise: Promise<RespanTelemetry | null> | null = null;
let initializationFailed = false;

export function getRespanTelemetry(): RespanTelemetry | null {
  const options = getRespanTracingOptions();
  if (!options) return null;

  if (!telemetryClient) {
    telemetryClient = new RespanTelemetry(options);
  }

  return telemetryClient;
}

export async function initializeRespanTelemetry(): Promise<RespanTelemetry | null> {
  if (initializationFailed) return null;

  const client = getRespanTelemetry();
  if (!client) return null;
  if (client.isInitialized()) return client;
  if (initializationPromise) return initializationPromise;

  initializationPromise = client
    .initialize()
    .then(() => {
      if (!client.isInitialized()) {
        initializationFailed = true;
        return null;
      }

      return client;
    })
    .catch(() => {
      initializationFailed = true;
      return null;
    })
    .finally(() => {
      initializationPromise = null;
    });

  return initializationPromise;
}

