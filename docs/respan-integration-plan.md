# Respan Integration Plan

Planning-only note. This document maps the current Aegis Desk codebase to a phased Respan rollout without changing production behavior.

## Goals

- Add tracing first, without changing model routing or offline/privacy behavior.
- Add structured workflow/task spans second, using the existing route/module boundaries.
- Add prompt-managed calls only on carefully selected LLM paths.
- Add gateway features only on high-value, low-regret paths after parity testing.

## Current Repo Map

### Route and AI call mapping

| Surface | Current file(s) | Current AI / non-AI behavior | Offline / privacy guard | Respan rollout note |
| --- | --- | --- | --- | --- |
| `/api/plan` | `src/app/api/plan/route.ts` | One `generateText(...)` call via `openai("gpt-4o-mini")` to build a JSON plan. | Route blocks when `isOfflineEnforced(...)` is true. | Good Phase 1 tracing candidate. Possible Phase 3 prompt-managed candidate. |
| `/api/run` | `src/app/api/run/route.ts` | Mixed pipeline: deterministic orchestration + Linkup search + two `generateObject(...)` OpenAI calls (`entity_profile`, `final_synthesis`). | Route blocks when offline is enforced. Research queries go through `privacyFirewall(...)` before Linkup. | Best overall Respan workflow candidate. Start tracing here first. |
| `/api/inbox` | `src/app/api/inbox/route.ts` | Large deterministic scanner with optional AI assist. LLM calls live in `runAssistModel(...)` / `llmAssistWithConsensus(...)` and use OpenAI / Google / Anthropic through AI SDK adapters. | Offline mode can fully force deterministic behavior. Gmail fetch and raw email handling are privacy-sensitive. | Trace route and AI subcalls, but do not gateway this path early. |
| `/api/agent` (legacy) | `src/app/api/agent/route.ts` | Single `generateText(...)` call via `openai("gpt-4o-mini")`. | Route blocks when offline is enforced. | Trace only. Low priority for prompt/gateway work because the route is legacy. |

### LLM client initialization today

There is no shared LLM client bootstrap layer in the repo today.

- `src/app/api/plan/route.ts`: inline `openai("gpt-4o-mini")`
- `src/app/api/run/route.ts`: inline `openai("gpt-4o-mini")`
- `src/app/api/inbox/route.ts`: inline `openai(...)`, `google(...)`, `anthropic(...)`
- `src/app/api/agent/route.ts`: inline `openai("gpt-4o-mini")`

This is important: Respan integration should be additive first, not a broad refactor to centralize all providers.

### Shared AI-adjacent utility layers

These are shared logic layers around the AI routes, but not shared model bootstrap code:

- `src/lib/agent/evidence.ts`
  - deterministic research scoring and conflict detection
- `src/lib/agent/claimVerification.ts`
  - deterministic local claim verification heuristics
- `src/lib/agent/finalFormatter.ts`
  - deterministic post-processing / audit formatting
- `src/lib/inbox/classifier.ts`
  - deterministic learned-classifier heuristics
- `src/lib/inbox/policy.ts`
  - deterministic inbox guardrails
- `src/lib/inbox/decision.ts`
  - deterministic final decision routing
- `src/lib/inbox/consensus.ts`
  - deterministic agreement/disagreement scoring across model outputs
- `src/lib/inbox/compatibility.ts`
  - deterministic explanation / uncertainty compatibility layer
- `src/lib/inbox/entityProfiler.ts`
  - deterministic entity extraction used by plan/run

### Offline-mode guards

Core guard modules:

- `src/lib/offline/runtime.ts`
- `src/lib/offline/index.ts`

Route-level enforcement points:

- `src/app/api/plan/route.ts`
- `src/app/api/run/route.ts`
- `src/app/api/agent/route.ts`
- `src/app/api/inbox/route.ts`

### Privacy / redaction / research / evidence

- `src/lib/tools/privacy.ts`
  - redacts emails, phones, and amounts before external search
- `src/app/api/run/route.ts`
  - applies `privacyFirewall(...)` before Linkup search
- `src/lib/tools/linkup.ts`
  - legacy Linkup wrapper
- `src/lib/agent/evidence.ts`
  - deterministic research scoring and conflict summaries
- `src/lib/agent/claimVerification.ts`
  - deterministic local-only claim verification notes
- `src/lib/inbox/entityProfiler.ts`
  - local entity extraction

## Code Path Classification

### Deterministic-only paths

These should remain deterministic and should not be replaced with LLM or prompt-managed logic:

- `src/lib/offline/*`
- `src/lib/tools/privacy.ts`
- `src/lib/tools/ics.ts`
- `src/lib/agent/evidence.ts`
- `src/lib/agent/claimVerification.ts`
- `src/lib/agent/finalFormatter.ts`
- `src/lib/inbox/classifier.ts`
- `src/lib/inbox/policy.ts`
- `src/lib/inbox/decision.ts`
- `src/lib/inbox/consensus.ts`
- `src/lib/inbox/compatibility.ts`
- the parsing / scoring / routing parts of `src/app/api/inbox/route.ts`

### AI-assisted paths

- `src/app/api/plan/route.ts`
  - one planner model call
- `src/app/api/run/route.ts`
  - entity profile generation
  - final synthesis generation
- `src/app/api/inbox/route.ts`
  - inbox assist / consensus model calls only
- `src/app/api/agent/route.ts`
  - legacy single model call

### Safe to trace immediately

These are safe for Phase 1 tracing because tracing can be metadata-first and non-routing:

- route entry / exit for `/api/plan`, `/api/run`, `/api/inbox`, `/api/agent`
- offline guard decisions
- redaction steps, but only with `safeQuery` or redaction counts
- Linkup search timing, result counts, and cache hit/miss counts
- evidence scoring / formatter / decision spans with counts and labels only
- AI SDK calls with metadata-first telemetry

### Not safe to route through gateway yet

- offline enforcement checks and deterministic safety modules
- Gmail fetch and raw-email ingestion in `/api/inbox`
- the full `/api/inbox` model path
  - multi-provider
  - latency-sensitive
  - contains raw email content
  - tightly coupled to deterministic safety routing
- Linkup and non-LLM external research
- any deterministic classification / policy / decision layer
- any prompt that would send raw inbox content through a new third-party path before privacy review

## Proposed Future File Locations

These are the planned integration points. They are intentionally narrow.

### 1. Respan bootstrap module

- `instrumentation.ts`

Reason:

- This is the cleanest Next.js App Router bootstrap point for Respan tracing.
- It matches the current official Respan guidance for Vercel AI SDK tracing with OpenTelemetry exporter wiring.

### 2. Trace metadata helper

- `src/lib/observability/respanMetadata.ts`

Reason:

- Keep route-specific metadata building separate from route business logic.
- Central place to sanitize / hash IDs and ensure privacy-safe metadata defaults.

Expected responsibility:

- build route-level metadata objects
- hash identifiers for `customer_identifier` / `thread_identifier`
- enforce “counts not content” defaults

### 3. Prompt-managed raw HTTP helper

- `src/lib/ai/respanPromptHttp.ts`

Reason:

- Current official Respan prompt schema v2 requires raw HTTP requests; OpenAI SDK validation strips required v2 fields.
- This helper should be isolated so only explicitly approved prompts use it.

Expected responsibility:

- call Respan prompt endpoint via `fetch`
- support `prompt_id`, `schema_version: 2`, `variables`, `patch`, and optional version pinning
- preserve a direct-provider fallback path during rollout

### 4. Optional gateway-aware client config

- `src/lib/ai/respanGateway.ts`

Reason:

- Keep gateway switching behind one small module instead of modifying each route ad hoc.
- This file should stay optional and feature-flagged.

Expected responsibility:

- expose env-driven gateway enablement checks
- provide OpenAI-compatible base URL / key config for approved paths only
- never be imported by deterministic-only modules

## Phased Rollout

### Phase 1: tracing only

Scope:

- Add Respan tracing bootstrap without changing provider routing.
- Use official Vercel AI SDK tracing path for current `generateText(...)` / `generateObject(...)` calls.
- Add route-level metadata and request grouping.

Targets:

- `/api/plan`
- `/api/run`
- `/api/inbox`
- `/api/agent`

Rules:

- No gateway.
- No prompt migration.
- No content tracing by default on inbox/manual-email paths.
- Keep all offline behavior exactly as-is.

Recommended implementation pattern:

- `instrumentation.ts` initializes Respan exporter.
- AI calls opt into telemetry with a helper-built metadata payload.
- Deterministic substeps are represented as workflow/task spans or OTel child spans with metadata only.

### Phase 2: structured workflow/task spans

Scope:

- Add explicit workflow/task structure around the current route pipelines.

Suggested workflow boundaries:

- `plan.request`
  - `plan.offline_guard`
  - `plan.entity_extraction`
  - `plan.llm_generate`
  - `plan.normalize`
- `run.request`
  - `run.offline_guard`
  - `run.redact_query`
  - `run.linkup_search`
  - `run.evidence_score`
  - `run.profile_cache_lookup`
  - `run.entity_profile_generate`
  - `run.final_synthesis_generate`
  - `run.final_format`
- `inbox.request`
  - `inbox.offline_guard`
  - `inbox.fetch_input`
  - `inbox.parse_and_score`
  - `inbox.classifier_guardrails`
  - `inbox.llm_assist`
  - `inbox.final_decision`
  - `inbox.persist_memory`
- `agent.legacy_request`
  - `agent.offline_guard`
  - `agent.llm_generate`

Rules:

- Keep deterministic modules unchanged.
- Wrap them; do not rewrite them.
- Prefer metadata-only spans for privacy-sensitive operations.

### Phase 3: prompt-managed calls where appropriate

Initial candidates:

- `/api/run` entity profile prompt
  - best first candidate because it already operates on structured search results rather than raw inbox content
- `/api/plan` planner prompt
  - possible second candidate
- `/api/run` final synthesis prompt
  - highest leverage, but higher privacy review burden

Not in first prompt-managed phase:

- `/api/inbox`
- deterministic inbox policies / classifier / decision routing

Rules:

- Use `src/lib/ai/respanPromptHttp.ts` only on approved prompts.
- Version-pin prompts at first.
- Keep the current direct AI SDK call as the fallback path.
- Prompt-managed rollout must be behind explicit env flags.

### Phase 4: selective gateway features

Start only after trace data shows stable prompt parity.

Recommended first gateway candidate:

- `/api/run` entity profile generation

Possible later candidates:

- `/api/plan`
- `/api/run` final synthesis

Do not route through gateway initially:

- `/api/inbox`
- `/api/agent` unless the route is kept and justified

Gateway features to consider only after parity:

- retries
- fallback models
- caching
- load balancing

Rules:

- default off
- route-scoped env flag
- fast rollback to current direct path
- no change to offline-enforced behavior

## Metadata Schema Proposal

Use privacy-safe metadata. Start with counts, modes, labels, and hashed identifiers rather than raw content.

### Common fields

```ts
{
  route: "/api/plan" | "/api/run" | "/api/inbox" | "/api/agent",
  workflow: string,
  task?: string,
  feature_phase: "trace_only" | "workflow_spans" | "prompt_managed" | "gateway",
  offline_state: "disabled" | "shadow" | "enforced",
  offline_enforced: boolean,
  privacy_level: "high" | "medium" | "low",
  trace_content: false | "redacted_only" | "approved",
  auth_role?: "user" | "admin" | "anonymous",
  customer_identifier?: string,   // hashed
  thread_identifier?: string,     // hashed where needed
  group_identifier?: string,      // request-level correlation id
  custom_identifier?: string      // route-specific id
}
```

### `/api/plan` fields

```ts
{
  command_present: boolean,
  email_chars: number,
  doc_chars: number,
  extracted_entity_count: number,
  search_step_count: number,
  model: "gpt-4o-mini"
}
```

### `/api/run` fields

```ts
{
  linkup_depth: "standard" | "deep",
  search_count: number,
  safe_query_count: number,
  profile_cache_enabled: boolean,
  profile_cache_hits: number,
  evidence_count: number,
  conflict_count: number,
  evidence_quality_score: number
}
```

### `/api/inbox` fields

```ts
{
  mode: "manual" | "gmail",
  scanned_count: number,
  processing_mode: "offline_enforced" | "hybrid_remote_llm",
  consensus_mode: "single" | "multi",
  consensus_max_models: number,
  learning_samples_used: number,
  high_count: number,
  medium_count: number,
  low_count: number
}
```

### Trace content policy

- Default Phase 1 setting: no raw prompt / response content for inbox traces.
- For `/api/run` and `/api/plan`, start with metadata only; enable content only after explicit review.
- For redaction spans, store only `safeQuery` and `removed` counts, never the raw query.
- For Gmail/manual inbox inputs, store only counts and route mode unless a later privacy review explicitly approves more.

## Risks and Sequencing

### Key risks

- The app currently uses Vercel AI SDK route-local calls, not a shared provider abstraction. A large “central client” refactor would create unnecessary regression risk.
- `/api/inbox` mixes deterministic routing, multiple providers, Gmail I/O, and raw email content. It is the easiest place to damage latency, privacy posture, or reliability if gateway work starts too early.
- Prompt management changes request shape. Official Respan prompt schema v2 requires raw HTTP, so that migration must be isolated and feature-flagged.
- Gateway adds latency. That matters most on inbox scanning and any multi-step route.

### Recommended sequence

1. Add tracing bootstrap and metadata helper.
2. Instrument live AI SDK calls with metadata-only telemetry.
3. Add workflow/task spans around `/api/run` first, then `/api/plan`, then `/api/inbox`.
4. Introduce prompt-managed helper for one prompt only: `/api/run` entity profile generation.
5. Validate parity and privacy posture.
6. Consider gateway features only for that same path.
7. Defer inbox gateway work until there is a strong reason and test coverage.

## What Should Remain Untouched

- `src/lib/offline/*`
- deterministic inbox safety logic in:
  - `src/lib/inbox/classifier.ts`
  - `src/lib/inbox/policy.ts`
  - `src/lib/inbox/decision.ts`
  - `src/lib/inbox/consensus.ts`
  - `src/lib/inbox/compatibility.ts`
- privacy redaction logic in `src/lib/tools/privacy.ts`
- research evidence scoring in `src/lib/agent/evidence.ts`
- local claim verification heuristics in `src/lib/agent/claimVerification.ts`
- final structured formatter in `src/lib/agent/finalFormatter.ts`
- Gmail token / fetch logic in `src/lib/inbox/gmail.ts`

Respan should wrap and observe these paths, not replace or weaken them.

## Official Respan Notes Used For This Plan

- TypeScript tracing SDK: official package is `@respan/respan`, with `Respan` initialization and structured tracing support.
- Vercel AI SDK tracing: official guidance uses Next OpenTelemetry setup plus `experimental_telemetry` on AI SDK calls.
- Prompt schema v2: official guidance says prompt-managed calls require raw HTTP because OpenAI SDK validation strips required prompt fields.
- Gateway: official docs describe an OpenAI-compatible base URL and note added latency, so gateway should be selective.
