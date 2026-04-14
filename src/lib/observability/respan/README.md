# Respan Foundation Layer

This folder contains the production-safe Respan foundation for Aegis Desk.

## What It Does

- reads Respan feature flags from environment variables
- provides a safe no-op bootstrap when Respan is disabled or not configured
- defines a typed metadata contract for Aegis Desk tracing
- exposes per-request metadata propagation helpers
- exposes reusable workflow/task span wrappers for future route instrumentation

## Environment Variables

The layer reads these server-side variables:

```bash
RESPAN_ENABLED=false
RESPAN_API_KEY=
RESPAN_BASE_URL=https://api.respan.ai
RESPAN_ENVIRONMENT=development
RESPAN_GATEWAY_ENABLED=false
RESPAN_PROMPTS_ENABLED=false
RESPAN_PROMPT_ID_PLAN=
RESPAN_PROMPT_ID_SYNTHESIS=
```

Notes:

- `RESPAN_ENABLED=false` keeps the entire layer dormant.
- Missing `RESPAN_API_KEY` also keeps runtime behavior in no-op mode.
- `RESPAN_BASE_URL` is used by the tracing client and reserved for later prompt-management and gateway work.
- `RESPAN_GATEWAY_ENABLED` stays opt-in and should only be enabled on routes that have been explicitly switched to a gateway-aware model client.
- `RESPAN_PROMPTS_ENABLED` and the prompt IDs are only needed when a route is intentionally moved to Respan-managed prompts.

## How To Enable It

1. Set `RESPAN_ENABLED=true`
2. Set a valid `RESPAN_API_KEY`
3. Optionally set `RESPAN_BASE_URL` and `RESPAN_ENVIRONMENT`
4. Leave `RESPAN_GATEWAY_ENABLED=false` and `RESPAN_PROMPTS_ENABLED=false` until the target route is verified
5. Restart the Next.js server

The root `instrumentation.ts` bootstrap will initialize the tracing client once when the app starts, but only when the config is valid.

## What Uses What Later

- Tracing-only:
  - `initializeRespan()`
  - `runWithRespanRequestMetadata(...)`
  - `withAegisWorkflowSpan(...)`
  - `withAegisTaskSpan(...)`
- Prompt-management later:
  - `promptClient.ts` uses Respan prompt schema v2 over raw HTTP for explicit opt-in routes
  - prompt IDs should remain unset until a route is deliberately moved to Respan-managed prompts
- Gateway later:
  - `gatewayClient.ts` is available for explicit opt-in routes
  - route-scoped model clients can read `RESPAN_GATEWAY_ENABLED`, but they should stay opt-in and must not affect offline enforcement

## Guardrails

- This layer does not change offline enforcement or outbound AI policy.
- Automatic provider instrumentation is disabled on purpose so routes can opt in deliberately.
- Trace content is disabled by default to preserve the repo's privacy-first posture.
