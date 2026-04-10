import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { mergeAegisRespanMetadata } from "./metadata";
import type { AegisRespanMetadataInput } from "./types";

const requestMetadataStore = new AsyncLocalStorage<AegisRespanMetadataInput>();

export function getRespanRequestMetadata(): AegisRespanMetadataInput {
  return requestMetadataStore.getStore() || {};
}

export function runWithRespanRequestMetadata<T>(
  metadata: AegisRespanMetadataInput,
  fn: () => Promise<T> | T
): Promise<T> | T {
  const merged = mergeAegisRespanMetadata(getRespanRequestMetadata(), metadata);
  return requestMetadataStore.run(merged, fn);
}

