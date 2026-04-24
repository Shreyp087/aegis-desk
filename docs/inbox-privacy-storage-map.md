# Aegis Inbox Privacy And Storage Map

This document is tied to the current inbox scanner implementation. It describes what the code stores, where it stores it, how long it keeps it, and in what form.

## Core distinction

- Raw email content: full RFC822-like message text, headers, and body.
- Derived data: hashes, scores, labels, extracted counts, classifier outputs, routing decisions, temporal signals, uncertainty, and evaluation metadata.

The inbox pipeline is local-first by default, but not every path is request-only. The current code has a few deliberate exceptions that are called out below.

## Storage map

| Surface | Where | Retention | Raw email content | Stored form |
| --- | --- | --- | --- | --- |
| In-request email handling | Server request memory | Request lifecycle only | Yes | Raw email, parsed headers/body, extracted entities |
| Temporal session store | Server request memory `Map` indexes | Request lifecycle only | No | Hashed sender/thread/subject-pattern keys, timestamps, scores, labels |
| Trust graph | Browser HttpOnly cookie `aegis_inbox_trust_graph` | 120 days maxAge, pruned to 80 sender + 80 domain entries | No | Hashed sender/domain keys, seen/high/medium counts, `lastSeen` |
| Browser scanner cache | Browser `sessionStorage` key `aegis:inbox-scanner-session:v1` | Until session storage is cleared or browser session ends | No | Derived alert payload, capsule, explanation, model outputs, `rawEmailAvailable` |
| Incident memory | MongoDB `IncidentMemory` collection when `MONGODB_URI` is set | Persistent until manually purged; no TTL | No | Source hashes, sender domain, subject hash, categories, labels, signals, explanation summary |
| Sender reputation snapshot | MongoDB `SenderReputationSnapshot` collection when `MONGODB_URI` is set | Persistent until manually purged; no TTL | No | Sender domain, hashed sender id, trust/reputation scores, counts |
| Feedback artifacts | MongoDB updates on `IncidentMemory` keyed by `sourceHash` | Same retention as `IncidentMemory` | No | Outcome label, corrected class, corrected priority score |
| Evaluation logs | MongoDB `InboxEvaluationLog` if Mongo is configured, else `data/inbox/scanner.evaluation.jsonl` | Persistent until manually purged | No | Prediction, rawPrediction, confidence, uncertainty, routing, consensus metadata, versions |
| Adaptive threshold cache | `data/inbox/adaptive_thresholds.json` | Persistent until manually removed | No | Threshold values, diagnostics, adjustment history |
| Optional model assist | External provider request in `hybrid_remote_llm` mode | Provider-controlled for raw request handling | Yes, when enabled | Raw email in prompt; local outputs include `suggestedAction`, `draftReply`, `consensusNote` |

## Current codepaths

### In-request email handling

- `src/app/api/inbox/route.ts`
  - `parseRawEmail()` parses raw email text into transient fields.
  - The `POST /api/inbox` handler keeps raw email in memory during scoring and response assembly.

### Temporal session store

- `src/lib/inbox/sessionStore.ts`
  - Stores only derived fields.
  - Uses `senderDomainHash`, `threadKeyHash`, `subjectPatternHash`, `clusterKey`, timestamps, and scores.
  - Does not retain raw body or raw subject after construction.

### Trust graph

- `src/app/api/inbox/route.ts`
  - `readTrustGraphCookie()` / `writeTrustGraphCookie()`
  - Cookie payload is base64url JSON.
  - Keys are hashes derived from sender email/domain.
  - Values are counts and `lastSeen`.

### Incident memory

- `src/app/api/inbox/route.ts`
  - `persistInboxMemory()`
- `src/lib/models/IncidentMemory.ts`
  - Stores derived memory and hashes.
  - Does not store raw email body.
  - Does store `senderDomain` in plain text.

### Sender reputation snapshots

- `src/app/api/inbox/route.ts`
  - `persistInboxMemory()` bulk-writes `SenderReputationSnapshot`
- `src/lib/models/SenderReputationSnapshot.ts`
  - Stores sender domain, hashed sender id, counts, and scores.

### Feedback artifacts

- `src/app/api/inbox/feedback/route.ts`
  - Updates `IncidentMemory` by `sourceHash`
  - Stores outcome labels and corrected class/priority only

### Evaluation logs

- `src/app/api/inbox/route.ts`
  - `persistInboxEvaluationLog()`
- `src/lib/inbox/evaluation.ts`
  - Writes to Mongo when configured
  - Falls back to local JSONL at `data/inbox/scanner.evaluation.jsonl`

### Adaptive threshold cache

- `src/lib/inbox/adaptiveThresholds.ts`
  - `saveAdaptiveThresholds()`
  - Writes derived threshold recommendations to `data/inbox/adaptive_thresholds.json`

### Optional model outputs

- `src/app/api/inbox/route.ts`
  - `llmAssistWithConsensus()`
  - Raw email is included in the provider prompt only in `hybrid_remote_llm` mode
  - Returned fields include `suggestedAction`, `draftReply`, `consensusNote`, `consensusScore`

## Current privacy caveats

These are the main trust boundaries and caveats around raw email handling.

### 1. Raw email is returned to the browser

- `src/app/api/inbox/route.ts`
  - `AlertSchema` includes `rawEmail`
- `src/components/InboxScannerPanel.tsx`
  - Uses `rawEmail` for body display, search, copy, and escalation helpers

Impact:

- Raw email content leaves request memory and becomes browser-visible by design.

### 2. Browser session cache strips raw email

- `src/components/InboxScannerPanel.tsx`
  - `persistInboxScannerSession()`
  - `PersistedInboxScannerSession` stores sanitized alerts without `rawEmail`
- `src/lib/inbox/browserSessionCache.ts`
  - `sanitizeAlertsForBrowserSession()`

Impact:

- The browser session cache keeps derived triage state only.
- Refreshed sessions can restore the queue state, but not the full raw message body.

### 3. Hybrid model assist sends raw email to configured providers

- `src/app/api/inbox/route.ts`
  - `llmAssistWithConsensus()`
  - `buildConsensusModelPool()`

Impact:

- In `hybrid_remote_llm` mode, raw email content is sent to the configured provider set for optional assistance.
- This is not part of the deterministic critical path when offline mode is enforced.

### 4. Sender domains are stored in plain text

- `src/lib/models/IncidentMemory.ts`
- `src/lib/models/SenderReputationSnapshot.ts`

Impact:

- This does not store message content, but it does store a persistent sender-domain identifier.

## What is derived-only

The following persisted layers do not store raw email content:

- `IncidentMemory`
- `InboxEvaluationLog`
- `SenderReputationSnapshot`
- trust graph cookie
- session store
- adaptive threshold cache

These layers store only:

- hashes
- counts
- labels
- scores
- uncertainty
- consensus metadata
- event/route/explanation summaries derived from the pipeline

## Product-facing trust statement this code can support truthfully

- Raw email is processed locally in request memory for scanning.
- Persistent server-side storage uses derived signals and hashes, not raw email bodies.
- The browser session currently caches scanner state without raw email content.
- Refreshed sessions may require a new scan before the full raw message body can be reopened or copied again.
- Remote model transfer is optional and only occurs in hybrid mode.
- The deterministic scoring and routing path remains available without remote model calls.
