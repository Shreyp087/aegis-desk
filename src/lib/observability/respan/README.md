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
```

Notes:

- `RESPAN_ENABLED=false` keeps the entire layer dormant.
- Missing `RESPAN_API_KEY` also keeps runtime behavior in no-op mode.
- `RESPAN_BASE_URL` is used by the tracing client and reserved for later prompt-management and gateway work.
- `RESPAN_GATEWAY_ENABLED` is intentionally config-only right now. No route uses gateway behavior yet.

## How To Enable It

1. Set `RESPAN_ENABLED=true`
2. Set a valid `RESPAN_API_KEY`
3. Optionally set `RESPAN_BASE_URL` and `RESPAN_ENVIRONMENT`
4. Restart the Next.js server

The root `instrumentation.ts` bootstrap will initialize the tracing client once when the app starts, but only when the config is valid.

## What Uses What Later

- Tracing-only:
  - `initializeRespan()`
  - `runWithRespanRequestMetadata(...)`
  - `withAegisWorkflowSpan(...)`
  - `withAegisTaskSpan(...)`
- Prompt-management later:
  - a dedicated raw HTTP helper should live outside this folder so prompt rollout stays isolated from base tracing
- Gateway later:
  - route-scoped model clients can read `RESPAN_GATEWAY_ENABLED`, but they should stay opt-in and must not affect offline enforcement

## Guardrails

- This layer does not change offline enforcement or outbound AI policy.
- Automatic provider instrumentation is disabled on purpose so routes can opt in deliberately.
- Trace content is disabled by default to preserve the repo's privacy-first posture.
