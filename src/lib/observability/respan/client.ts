import "server-only";

import { RespanTelemetry } from "@respan/tracing";

import { getRespanTracingOptions } from "./config";

type RespanClientState = {
  telemetryClient: RespanTelemetry | null;
  initializationPromise: Promise<RespanTelemetry | null> | null;
  initializationFailed: boolean;
};

declare global {
  var __aegisRespanClientState__: RespanClientState | undefined;
}

function getRespanClientState(): RespanClientState {
  if (!globalThis.__aegisRespanClientState__) {
    globalThis.__aegisRespanClientState__ = {
      telemetryClient: null,
      initializationPromise: null,
      initializationFailed: false,
    };
  }

  return globalThis.__aegisRespanClientState__;
}

export function getRespanTelemetry(): RespanTelemetry | null {
  const state = getRespanClientState();
  const options = getRespanTracingOptions();
  if (!options) return null;

  if (!state.telemetryClient) {
    state.telemetryClient = new RespanTelemetry(options);
  }

  return state.telemetryClient;
}

export async function initializeRespanTelemetry(): Promise<RespanTelemetry | null> {
  const state = getRespanClientState();
  if (state.initializationFailed) return null;

  const client = getRespanTelemetry();
  if (!client) return null;
  if (client.isInitialized()) return client;
  if (state.initializationPromise) return state.initializationPromise;

  state.initializationPromise = client
    .initialize()
    .then(() => {
      if (!client.isInitialized()) {
        state.initializationFailed = true;
        return null;
      }

      return client;
    })
    .catch(() => {
      state.initializationFailed = true;
      return null;
    })
    .finally(() => {
      state.initializationPromise = null;
    });

  return state.initializationPromise;
}
