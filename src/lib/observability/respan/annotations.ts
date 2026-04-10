import "server-only";

import { getClient } from "@respan/tracing";

import {
  buildAegisRespanMetadata,
  mergeAegisRespanMetadata,
  toRespanAssociationProperties,
} from "./metadata";
import { getRespanRequestMetadata } from "./context";
import type { AegisRespanMetadataInput } from "./types";

type SpanEventAttributes = Record<string, string | number | boolean>;

function normalizeEventAttributes(
  attributes: SpanEventAttributes | undefined
): SpanEventAttributes | undefined {
  if (!attributes) return undefined;

  const filtered = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined)
  ) as SpanEventAttributes;

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function annotateAegisCurrentSpan(
  metadataInput: AegisRespanMetadataInput = {}
): void {
  const client = getClient();
  if (!client.isRecording()) return;

  const metadata = buildAegisRespanMetadata(
    mergeAegisRespanMetadata(getRespanRequestMetadata(), metadataInput)
  );

  client.updateCurrentSpan({
    respanParams: {
      customerIdentifier:
        typeof metadata.customer_identifier === "string"
          ? metadata.customer_identifier
          : undefined,
      traceGroupIdentifier:
        typeof metadata.group_identifier === "string"
          ? metadata.group_identifier
          : undefined,
      metadata: toRespanAssociationProperties(metadata),
    },
  });
}

export function addAegisSpanEvent(
  name: string,
  attributes?: SpanEventAttributes
): void {
  const client = getClient();
  if (!client.isRecording()) return;

  client.addEvent(name, normalizeEventAttributes(attributes));
}

export function recordAegisSpanException(error: Error): void {
  const client = getClient();
  if (!client.isRecording()) return;
  client.recordException(error);
}
