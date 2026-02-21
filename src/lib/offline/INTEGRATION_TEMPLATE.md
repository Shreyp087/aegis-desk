# Offline Mode Integration

Offline mode is now runtime-wired for inbox and guardrails.

## Current status
- `src/app/api/inbox/route.ts` supports offline-enforced scam categorization + trusted decisions.
- `src/app/api/plan/route.ts`, `src/app/api/run/route.ts`, and `src/app/api/agent/route.ts` reject calls when offline is enforced.
- Runtime config is loaded from `src/lib/offline/runtime.ts`.

## Infra hardening still required (outside app code)
- Deny outbound network egress at container/VM/firewall layer.
- Encrypt local stores and rotate keys.
- Apply default log redaction.

## Env template
```env
# server runtime
OFFLINE_MODE=true
OFFLINE_MODE_STATE=enforced
OFFLINE_BLOCK_OUTBOUND=true
OFFLINE_LOCAL_MODELS_ONLY=true
OFFLINE_ALLOW_EXTERNAL_RESEARCH=false
OFFLINE_ALLOW_REMOTE_DRAFTING=false

# optional UI badge
NEXT_PUBLIC_OFFLINE_MODE=true
NEXT_PUBLIC_OFFLINE_MODE_STATE=enforced
```
