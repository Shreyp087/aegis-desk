import "server-only";

import { initializeRespanTelemetry } from "./client";
import { getRespanRequestMetadata, runWithRespanRequestMetadata } from "./context";
import {
  buildAegisRespanMetadata,
  mergeAegisRespanMetadata,
  toRespanAssociationProperties,
  toRespanSpanParams,
} from "./metadata";
import type { AegisRespanSpanOptions } from "./types";

type SpanKind = "workflow" | "task";

async function runNamedSpan<T>(
  kind: SpanKind,
  options: AegisRespanSpanOptions,
  fn: () => Promise<T> | T
): Promise<T> {
  const metadata = buildAegisRespanMetadata(
    mergeAegisRespanMetadata(getRespanRequestMetadata(), options.metadata, {
      endpoint: options.metadata?.endpoint || options.name,
    })
  );

  return runWithRespanRequestMetadata(metadata, async () => {
    const telemetry = await initializeRespanTelemetry();
    if (!telemetry) {
      return await fn();
    }

    const decoratorConfig = {
      name: options.name,
      version: options.version,
      traceContent: false,
      associationProperties: toRespanAssociationProperties(metadata),
    };

    const wrapped = () =>
      telemetry.withRespanSpanAttributes(() => fn(), toRespanSpanParams(metadata));

    if (kind === "workflow") {
      return await telemetry.withWorkflow(decoratorConfig, wrapped);
    }

    return await telemetry.withTask(decoratorConfig, wrapped);
  });
}

export function withAegisWorkflowSpan<T>(
  options: AegisRespanSpanOptions,
  fn: () => Promise<T> | T
): Promise<T> {
  return runNamedSpan("workflow", options, fn);
}

export function withAegisTaskSpan<T>(
  options: AegisRespanSpanOptions,
  fn: () => Promise<T> | T
): Promise<T> {
  return runNamedSpan("task", options, fn);
}

