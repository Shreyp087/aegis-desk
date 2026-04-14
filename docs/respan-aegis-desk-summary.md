# Respan Integration in Aegis Desk

## Current State

### Live today
- Foundation bootstrap is active through [instrumentation.ts](../instrumentation.ts) when `RESPAN_ENABLED=true` and `RESPAN_API_KEY` is set.
- `/api/plan` has the most complete Respan rollout:
  - workflow span
  - task spans for normalization, prompt build, LLM call, schema validation, and response assembly
  - structured metadata plus AI SDK telemetry metadata
- `/api/inbox` currently has a top-level workflow span only.
- `/api/run` now has structured tracing for validation, plan execution, search, evidence aggregation, entity profile generation, synthesis, and response assembly.
- `/api/run` final synthesis can optionally use a Respan-managed prompt over raw HTTP with prompt schema v2, and falls back to the existing inline AI SDK path if the prompt flag is off, the prompt ID is missing, or the prompt call fails schema validation.

### Not live yet
- `/api/run` is not routing model calls through a Respan gateway-aware client.
- `/api/inbox` does not yet have nested task spans around its AI-assisted branches.

## Environment Values

Add these values to `.env.local`:

```bash
RESPAN_ENABLED=false
RESPAN_API_KEY=
RESPAN_BASE_URL=https://api.respan.ai
RESPAN_ENVIRONMENT=development
RESPAN_GATEWAY_ENABLED=false
RESPAN_PROMPTS_ENABLED=false
RESPAN_PROMPT_ID_PLAN=
RESPAN_PROMPT_ID_SYNTHESIS=
RESPAN_PROMPT_ID_REPLY_DRAFT=
```

Notes:
- Keep `RESPAN_ENABLED=false` until you have a valid key and want live traces.
- Keep `RESPAN_GATEWAY_ENABLED=false` until a specific route has been validated with a gateway-aware client.
- Keep `RESPAN_PROMPTS_ENABLED=false` until a specific route has been moved to prompt management.

## Route Mapping

### `/api/plan`
- Status: primary validated Respan path
- Spans:
  - `plan.request`
  - `plan.offline_guard`
  - `plan.input_normalization`
  - `plan.prompt_construction`
  - `plan.llm_planner_call`
  - `plan.schema_validation`
  - `plan.response_assembly`
- Metadata:
  - `service`
  - `surface=plan`
  - `endpoint=/api/plan`
  - `workflow_type=plan`
  - `offline_mode`
  - `selected_model`
  - `parse_success`
  - `schema_validation_result`
  - request and thread identifiers when available

### `/api/inbox`
- Status: partial tracing only
- Spans:
  - `api.inbox.workflow`
- Deterministic logic remains outside model control:
  - scoring
  - guardrails
  - routing
  - policy decisions

### `/api/run`
- Status: structured tracing is live in code; final synthesis supports optional Respan prompt-management with a safe inline fallback, and gateway use is still off
- Spans:
  - `run.request`
  - `run.request_validation`
  - `run.plan_execution`
  - `run.redact_and_search`
  - `run.create_ics`
  - `run.evidence_aggregation`
  - `run.entity_profile_generation`
  - `run.entity_profile_model_call`
  - `run.final_synthesis`
  - `run.response_assembly`
- Metadata:
  - `service`
  - `surface=run`
  - `endpoint=/api/run`
  - `workflow_type=run`
  - `offline_mode`
  - `search_provider=linkup`
  - `selected_model`
  - `evidence_count`
  - request, customer, and thread identifiers when available
- Safe future path:
  - tracing-only first
  - prompt-managed synthesis lane is available now for final synthesis only
  - gateway-aware synthesis lane last

## Demo Setup

For tracing only:

```bash
RESPAN_ENABLED=true
RESPAN_API_KEY=your_respan_api_key
RESPAN_ENVIRONMENT=development
npm run dev
```

Optional later flags:

```bash
RESPAN_GATEWAY_ENABLED=true
RESPAN_PROMPTS_ENABLED=true
RESPAN_PROMPT_ID_PLAN=your_plan_prompt_id
RESPAN_PROMPT_ID_SYNTHESIS=your_synthesis_prompt_id
```

## Guardrails

- Offline enforcement must remain unchanged.
- Deterministic inbox policy and priority logic must stay deterministic.
- Trace content stays metadata-first until prompt review/privacy approval is complete.
- Gateway rollout should be route-scoped and reversible with env flags.
