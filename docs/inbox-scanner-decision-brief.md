# Inbox Scanner Decision Brief

## Purpose

This document explains the current inbox scanner decision pipeline in Aegis Desk from top to bottom, based on the code that is actually running today.

It focuses on:

- how `/api/inbox` accepts input
- every signal used to score, classify, and route mail
- where deterministic logic ends and model-assisted logic begins
- how uncertainty, guardrails, feedback, and persistence affect the result

It does not describe downstream deep-analysis behavior in `/api/plan` or `/api/run` except where those routes are relevant to understanding what the inbox scanner does not do.

## Scope and primary files

### Core decision path

- `src/app/api/inbox/route.ts`
- `src/lib/inbox/classifier.ts`
- `src/lib/inbox/importance.ts`
- `src/lib/inbox/policy.ts`
- `src/lib/inbox/signals.ts`
- `src/lib/inbox/compatibility.ts`
- `src/lib/inbox/consensus.ts`
- `src/lib/inbox/decision.ts`
- `src/lib/inbox/settings.ts`
- `src/lib/inbox/schemas.ts`
- `src/lib/inbox/evaluation.ts`

### Supporting input, learning, and persistence

- `src/lib/inbox/gmail.ts`
- `src/app/api/inbox/gmail/connect/route.ts`
- `src/app/api/inbox/gmail/callback/route.ts`
- `src/app/api/inbox/gmail/status/route.ts`
- `src/app/api/inbox/settings/route.ts`
- `src/app/api/inbox/feedback/route.ts`
- `src/lib/models/IncidentMemory.ts`
- `src/lib/models/SenderReputationSnapshot.ts`
- `src/lib/offline/runtime.ts`
- `src/lib/offline/template.ts`

### Explicitly not part of initial scanner classification

These files are inbox-adjacent, but they are not part of the first-pass scanner decision algorithm:

- `src/app/api/plan/route.ts`
- `src/app/api/run/route.ts`
- `src/lib/inbox/entityProfiler.ts`

Entity profiling and deeper research happen later in the Agent Desk workflow, not in the initial inbox scan.

## High-level pipeline

At a high level, the inbox scanner does this:

1. parse the request body
2. determine offline mode and consensus settings
3. fetch raw emails from manual input or Gmail
4. parse each raw email into structured fields
5. load thread context, trust context, and incident memory hints
6. score each email across category buckets
7. compute a decision-importance profile
8. run the hybrid classifier
9. apply priority guardrails
10. estimate uncertainty and evidence strength
11. build a trusted decision seed
12. run offline deterministic assist or model assist / consensus
13. re-calibrate uncertainty with consensus outcome
14. apply action guardrails
15. derive threat type and mail class, then reconcile those with classifier output
16. build structured uncertainty, explanation, decision trace, and final routing action
17. update trust memory, incident memory, sender snapshots, and evaluation logs
18. return `alerts[]` plus aggregate `meta`

## Request entry point

The entry point is `POST /api/inbox` in `src/app/api/inbox/route.ts`.

The request schema accepts:

- `mode`: `manual` or `gmail`
- `emails`: array of raw email strings for manual mode
- `gmail.maxResults`
- `gmail.query`
- `userContext.orgDomains`: optional allowlist of internal organization domains

Important runtime configuration resolved at request start:

- offline runtime config from `getOfflineRuntimeConfig()`
- consensus policy from env plus optional admin override cookie
- decision routing config from env via `buildEnvDecisionPolicyConfig()`

## Inputs that affect inbox decisions

The scanner is not driven by raw email text alone. Decisions are influenced by all of the following.

### Direct request inputs

- raw email body / headers
- source mode: manual vs Gmail
- organization domain list
- Gmail query and max result count

### Cookies

- trust graph cookie: `aegis_inbox_trust_graph`
- admin inbox settings cookie: `aegis_inbox_admin_settings`
- Gmail OAuth and token cookies handled by the Gmail routes

### Environment variables that materially change behavior

- `OPENAI_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `ANTHROPIC_API_KEY`
- `INBOX_CONSENSUS_ENABLED`
- `INBOX_CONSENSUS_MAX_MODELS`
- `INBOX_POLICY_VERSION`
- `INBOX_DECISION_AUTO_TRIAGE_CONFIDENCE_MIN_PCT`
- `INBOX_DECISION_AUTO_TRIAGE_UNCERTAINTY_MAX_PCT`
- `INBOX_DECISION_ESCALATE_CONFIDENCE_MIN_PCT`
- `INBOX_DECISION_ESCALATE_UNCERTAINTY_MAX_PCT`
- `INBOX_DECISION_RISK_MEDIUM_MIN_SCORE`
- `INBOX_DECISION_RISK_HIGH_MIN_SCORE`
- `INBOX_DECISION_POLICY_VERSION`
- `MONGODB_URI`
- `OFFLINE_MODE`
- `OFFLINE_MODE_STATE`
- `OFFLINE_BLOCK_OUTBOUND`
- `OFFLINE_LOCAL_MODELS_ONLY`
- `OFFLINE_ALLOW_EXTERNAL_RESEARCH`
- `OFFLINE_ALLOW_REMOTE_DRAFTING`
- `OFFLINE_REDACT_LOGS_BY_DEFAULT`
- `OFFLINE_STORE_RAW_EMAIL_DAYS`
- `OFFLINE_DECISION_POLICY_VERSION`
- `AEGIS_DATA_DIR`

### Stored historical inputs

If Mongo is configured, the scanner also uses:

- prior incident memory documents matched by sender domain, sender email hash, or subject hash
- stored user feedback from `/api/inbox/feedback`
- stored sender reputation snapshots

## Step 1: Source acquisition

The scanner supports two source modes.

### Manual mode

- uses `emails[]` from the request body directly
- no network fetch required

### Gmail mode

- requires a valid Gmail OAuth token in cookies
- uses `fetchLatestGmailRawEmails()`
- can be blocked when offline enforcement disables outbound network access

If offline is enforced and Gmail mode is requested while outbound network is blocked, the route returns `503` immediately.

## Step 2: Raw email parsing

Each email is normalized by `parseRawEmail()`.

### Fields extracted

- `from`
- `subject`
- `senderEmail`
- `senderDomain`
- `body`
- `threadKey`
- `deadlines[]`
- `moneyMentions[]`
- `urls[]`
- `attachments[]`
- `attachmentRiskScore`
- `urlDomains[]`

### Header/body extraction rules

- `Subject:` header if present, else `(No subject)`
- `From:` header if present, else `(Unknown sender)`
- body starts after a `Body:` line if present
- otherwise the parser strips common headers and keeps the remaining text

### Deadline extraction patterns

The scanner extracts phrases like:

- `by end of day`
- `eod`
- `end of week`
- `within <n> hours/days/weeks`
- month/day/year date strings
- ISO dates
- `today`
- `tomorrow`

### Money extraction patterns

- dollar amounts like `$1,200.00`
- `USD 1200`

### URL extraction

- any `http://` or `https://` URL
- domains are then derived from parsed URLs

### Attachment extraction and risk

Attachment names come from:

- `Attachments:` header values
- file-name pattern matches in raw content

Extension-based risk scoring:

- high-risk extensions add `26` each
- medium-risk extensions add `12` each
- `4+` attachments add `6`
- final attachment risk is clamped to `0..100`

High-risk extensions:

- `exe`, `js`, `vbs`, `bat`, `cmd`, `scr`, `hta`, `iso`, `dll`

Medium-risk extensions:

- `zip`, `rar`, `7z`, `docm`, `xlsm`, `pptm`, `html`, `htm`

## Step 3: Thread context

The scanner builds a `threadKey` from:

- Gmail `Thread-Id` if present
- otherwise a fallback key derived from sender domain plus normalized subject

`buildThreadProfiles()` then computes for each thread:

- `depth`: number of emails with the same thread key
- `riskDensity`: normalized mix of risk hits and urgency hits across the thread

Important detail:

- urgency is adjusted downward for low-risk promotional threads so promo countdown language does not inflate thread risk

## Step 4: Trust graph and sender trust score

The scanner maintains a trust graph in a cookie named `aegis_inbox_trust_graph`.

### Stored per sender/domain

Each trust node stores:

- `seen`
- `high`
- `medium`
- `lastSeen`

### Trust score formula

`getTrustScore()` blends sender and domain trust.

Each node score starts at `45` and then changes by:

- `+ min(20, seen * 3.2)`
- `- min(28, high * 7)`
- `- min(10, medium * 2)`
- `+ recency boost` of `6` if seen within 14 days, `2` if within 45 days

Final sender/domain blend:

- `senderScore * 0.55 + domainScore * 0.45`
- clamped to `5..95`

Interpretation:

- more prior appearances increases trust
- frequent high-priority history reduces trust
- frequent medium-priority history reduces trust modestly
- recent history helps

After the scan, every returned alert updates the trust graph again using the alert’s final priority.

## Step 5: Reputation profile

`buildReputationProfile()` is separate from trust history. It is a structural reputation check on sender and linked domains.

### Inputs

- sender domain
- URL domains extracted from links
- organization allowlist domains
- trust score

### Reputation penalties and bonuses

The function adjusts a risk accumulator based on:

- missing sender domain: `+20`
- suspicious TLDs: `+20`
- punycode / homograph pattern: `+18`
- many hyphens: `+8`
- high numeric ratio in domain: `+8`
- impersonation-prone keywords in domain: `+6`
- mismatch between sender domain and linked domains: `+12`
- free-mail sender domain for business-critical mail: `+14`
- organization allowlist domain match: `-18`
- strong trust score `>= 78`: `-10`
- weak trust score `<= 30`: `+10`

Suspicious TLDs hardcoded today:

- `.xyz`, `.top`, `.click`, `.icu`, `.ru`, `.work`, `.live`

Free-mail domains hardcoded today:

- `gmail.com`, `yahoo.com`, `outlook.com`, `hotmail.com`, `proton.me`, `icloud.com`

Final reputation score:

- `100 - risk`, clamped to `5..98`

## Step 6: Incident memory hints

If `MONGODB_URI` is configured, `loadIncidentHints()` loads historical hints from `IncidentMemoryModel`.

### Match keys used

- sender domain
- hashed sender email
- hashed subject

### Fields read back as hints

- `mailClass`
- `threatType`
- `trustedAction`
- `priorityScore`
- `outcomeLabel`

### Why this matters

These hints feed both:

- the decision-importance affinity score
- the hybrid classifier’s learned-history terms

This is the main learning loop used by the scanner today.

## Step 7: Pattern buckets used for category scoring

The scanner uses regex buckets in `PATTERNS`.

### Security bucket

Examples:

- `password`
- `credentials`
- `login`
- `reset`
- `2fa`
- `mfa`
- `verify your account`
- `security alert`
- `suspicious sign-in`

### Payment bucket

Examples:

- `wire transfer`
- `bank details`
- `invoice`
- `payment`
- `ach`
- `beneficiary`
- `account number`
- `refund`

### Legal bucket

Examples:

- `agreement`
- `contract`
- `nda`
- `indemnif`
- `liability`
- `terms`
- `governing law`
- `signature`

### Deadline bucket

Examples:

- `urgent`
- `asap`
- `immediately`
- `action required`
- `within <n> hours/days`
- `today`
- `tomorrow`
- `eod`
- `end of day`
- `due`

### Scheduling bucket

Examples:

- `meeting`
- `call`
- `calendar`
- `schedule`
- `reschedule`
- `invite`
- `availability`

### Executive bucket

Examples:

- `ceo`, `cfo`, `cto`, `founder`, `board`, `executive`

### Sales bucket

Examples:

- `proposal`
- `quote`
- `demo`
- `pricing`
- `discount`
- `trial`
- `promo code`
- `coupon`
- `% off`
- `bogo`
- `sale`

### Support bucket

Examples:

- `ticket`
- `incident`
- `outage`
- `issue`
- `bug`
- `support`

### Newsletter bucket

Examples:

- `unsubscribe`
- `newsletter`
- `weekly digest`
- `marketing`
- `promotion`

### Impersonation bucket

Examples:

- `ceo request`
- `cfo request`
- `executive request`
- `on behalf of`
- `keep this confidential`
- `do not call`
- `gift card`
- `vendor changed bank details`
- `new bank account`

### Malware bucket

Examples:

- `enabled macro`
- `macro-enabled`
- `download attachment`
- `open attachment`

### Promotional urgency suppression buckets

Extra patterns exist to suppress fake urgency on low-risk promotions:

- `today only`
- `ends tonight`
- `last chance`
- `final hours`
- `ending soon`
- `limited time offer`
- `shop now`
- `claim your deal`

Sender promo hints also look for:

- `deal`, `offer`, `promo`, `sale`, `marketing`, `newsletter`, `updates`, `shop`, `no-reply`

## Step 8: Promotional context normalization

`buildPromotionalContext()` is a key anti-noise function.

It computes:

- `salesHits`
- `newsletterHits`
- `promoUrgencyHits`
- `senderPromoHits`
- `promotionalConfidence`
- `lowRiskPromotional`
- `effectiveDeadlineHits`

### Promotional confidence formula

`promotionalConfidence = sales*0.7 + newsletter*0.95 + promoUrgency*0.7 + senderPromo*0.8`

### Low-risk promotional condition

A message is treated as low-risk promotional if:

- `promotionalConfidence >= 2.1`
- no security hits
- no payment hits
- no legal hits
- no impersonation hits
- no malware hits
- attachment risk `< 25`

### Effect on scoring

If a message is low-risk promotional:

- promo urgency is subtracted from deadline pressure
- deadline-related category scoring is softened
- promotional messages stop hijacking the urgency path as easily

## Step 9: Category scoring

`buildCategoryScores()` calculates 14 category scores from the parsed email, threat context, trust, reputation, and thread context.

### Categories

- `scam_bec`
- `scam_invoice_fraud`
- `scam_credential_phishing`
- `scam_malware_attachment`
- `scam_impersonation`
- `security_phishing`
- `finance_payment`
- `legal_contract`
- `deadline_scheduling`
- `executive_escalation`
- `sales_marketing`
- `ops_support`
- `newsletter`
- `general`

### Shared context terms

Several category formulas reuse these booleans:

- `externalSender`
- `suspiciousDomain`
- `trustRisk` if trust score `<= 35`
- `reputationRisk` if reputation score `<= 45`
- `thread.riskDensity`

### Important scoring patterns

The scam/security/payment categories are threat-heavy and combine:

- regex hit counts
- external sender penalty
- suspicious domain penalty
- trust/reputation risk
- money mention counts
- attachment risk
- URL count
- thread risk density

The business/process categories are lighter-weight:

- `legal_contract`: legal hits, extracted deadlines, thread depth
- `deadline_scheduling`: scheduling hits, deadline hits, thread depth, thread risk density, minus promotional pressure when applicable
- `executive_escalation`: executive hits plus urgency/externality
- `sales_marketing`: sales hits, promo sender hints, newsletter hints, promo urgency, minus security hits
- `newsletter`: newsletter hits, sender promo hints, promo urgency, minus security/payment/deadline influence
- `general`: fallback base score with small schedule/external adjustments and promotional discounting

### Primary category rule

After sorting category scores descending:

- if top score is `>= 18`, top category becomes `primaryCategory`
- otherwise the scanner falls back to `general`

## Step 10: Decision-importance profile

`buildDecisionImportanceProfile()` converts category scores plus history and context into a second layer of decision scoring.

This is one of the most important parts of the scanner because it separates:

- threat
- urgency
- relevance
- opportunity
- noise
- trust gap
- affinity

### Affinity score

Affinity is learned from incident hints.

Positive history:

- `spam_false_positive`
- `actionable_correct`
- `informational_correct`

Negative history:

- `harmful_true_positive`
- `spam_true_positive`

The function adds a memory-depth bonus and clamps final affinity to `0..100`.

### Trust gap score

Built from:

- inverse trust score
- inverse reputation score
- external sender bonus
- suspicious domain bonus
- URL count
- attachment risk

### Threat score

Built from:

- scam category peak
- security score
- finance score
- attachment risk
- URL count
- trust gap
- reduced by affinity

### Urgency score

Built from:

- deadline category score
- legal score
- finance score
- executive score
- support score
- deadline count
- raw deadline hit counts
- scheduling hit counts
- career-related patterns
- thread depth bonus

### Relevance score

Built from:

- affinity
- trust score
- reputation score
- thread depth
- career-related patterns
- business-category bonuses
- internal sender bonus
- newsletter/sales deductions

### Opportunity score

Built from:

- sales score
- newsletter score
- opportunity-pattern hits
- affinity
- career-pattern hits
- threat deduction
- trust-gap deduction

Opportunity is then capped downward for non-preferred promotions.

### Noise score

Built from:

- newsletter score
- sales score
- low signal count bonus
- no-deadline bonus
- no-career bonus
- deductions from opportunity, relevance, urgency, threat
- extra penalty for non-preferred promotions

### Attention type thresholds

The scanner maps the score profile into one of four attention modes:

- `verify_now` if `threat >= 72` and `trustGap >= 55`
- `act_now` if `urgency >= 62` and `relevance >= 50`
- `ignore_routine` if noise is high and threat/urgency/opportunity/relevance are low enough
- otherwise `review_later`

## Step 11: Raw priority score

Inside `scoreEmail()`, the scanner converts the decision-importance profile into a numeric priority score.

### Base formula

`priorityScore = 6 + threat*0.34 + urgency*0.33 + relevance*0.19 + opportunity*0.15 - noise*0.3`

### Combo overrides

The score is then snapped to floors/caps for important combinations:

- `verifyNowCombo`: threat `>= 72` and trust gap `>= 55` -> floor `84`
- `actNowCombo`: urgency `>= 70` and relevance `>= 48` -> floor `80`
- `valuableOpportunityCombo`: opportunity `>= 62`, affinity `>= 28`, threat `< 58` -> floor `56`
- `routineNoiseCombo`: noise `>= 74`, urgency `< 45`, threat `< 50`, opportunity `< 60` -> cap `36`

Final priority bands:

- `high` if score `>= 80`
- `medium` if score `>= 50`
- `low` otherwise

## Step 12: Risk tags and human-readable signals

`scoreEmail()` creates two descriptive outputs before the classifier runs.

### Risk tags

Examples include:

- `BEC Scam`
- `Invoice Scam`
- `Credential Phishing`
- `Malware Risk`
- `Impersonation`
- `Security`
- `Payment`
- `Legal`
- `External Sender`
- `Suspicious Domain`
- `Deadline Pressure`
- `Executive Escalation`
- `Impersonation Language`
- `Suspicious Attachment`
- `Weak Entity Reputation`
- `Low Historical Trust`
- `Trust Gap`

### Signals

Examples include:

- counts for security/payment/legal/urgency/impersonation signals
- attachment risk score
- external sender and suspicious domain notes
- combo pattern notes such as `verify-now pattern`, `act-now pattern`, `ignore-routine pattern`
- thread depth and risk density
- newsletter signature note
- full decision profile score tuple
- historical affinity score if present

These do not directly determine final class on their own, but they are reused by guardrails, classifier inputs, explanation generation, and decision trace construction.

## Step 13: Hybrid classifier

`classifyInboxMail()` is a deterministic statistical classifier, not an LLM call.

It produces:

- class probabilities for `spam`, `harmful`, `actionable`, `informational`
- `predictedClass`
- `memorySampleCount`
- `rationale`
- `modelVersion = inbox-hybrid-classifier-v2`

### Inputs used by the classifier

- primary category
- category scores
- risk tags
- signals
- trust score
- reputation score
- thread depth
- thread risk density
- attachment risk
- URL count
- money mention count
- deadline count
- incident hints
- decision-importance profile

### Learned-history terms

The classifier computes:

- `spamHistory`
- `harmfulHistory`
- `falsePositivePressure`
- `safeAffinity`
- `confirmedSpam`
- `confirmedHarmful`

These are ratios derived from incident hints with stored `outcomeLabel` values.

### Logit families

- `spamLogit`: higher for newsletter/sales/noise/history of spam; lower for security/finance/opportunity/relevance/false-positive pressure/safe affinity
- `harmfulLogit`: higher for scam peak, security, finance, threat, trust gap, attachment risk, URLs, weak trust/reputation, risky thread density, harmful history
- `actionableLogit`: higher for deadlines, support/legal urgency, relevance, opportunity, deadlines/money mentions, thread depth, safe affinity
- `informationalLogit`: higher for general/low-signal/low-risk/noisy messages, lower for threat and urgency

### Probability normalization

Each logit goes through `sigmoid()`, then the four values are normalized to sum to `1`.

### Predicted-class override rules

After ranking probabilities:

- if `harmful >= 0.66`, predicted class becomes `harmful`
- if `spam >= 0.6` and `harmful < 0.5`, predicted class becomes `spam`
- otherwise top probability wins

## Step 14: Priority guardrails

`applyPriorityGuardrails()` can change the raw priority score.

This is an important deterministic correction layer.

### Guardrail inputs

- category scores
- raw priority score
- deadline count
- signals
- trust score
- reputation score
- attachment risk score
- URL count
- classifier probabilities
- decision-importance profile

### Notable conditions

#### Promo / newsletter caps

If a message looks promotional and risky evidence is weak:

- cap to `36` for strong spammy promotions: `spam_promotional_low_cap`
- cap to `46` for spam with low signal count: `spam_low_signal_cap`
- cap to `38` for non-preferred promotional noise: `nonpreferred_promo_low_cap`

#### Valuable promotional floor

If a promotional message looks genuinely valuable to the user:

- floor to `54`: `valuable_offer_medium_floor`

This requires strong opportunity and affinity plus low threat.

#### Harmful floor

If harmful probability is high and risky evidence is strong:

- floor to `84`: `harmful_priority_floor`

#### Urgent decision floor

If urgency and relevance are both elevated:

- floor to `80`: `urgent_decision_high_floor`

#### Deadline floor

If the category is `deadline_scheduling`, there is a deadline, relevance is meaningful, and spam probability is low:

- floor to `80`: `deadline_high_floor`

#### Memory spam cap

If memory depth is at least 3 and spam probability is high without risky evidence:

- cap to `42`: `memory_spam_cap`

## Step 15: Evidence strength and base uncertainty

Before any model assist is used, the route computes two intermediate values.

### Evidence strength

`evidenceStrength = topCategoryScore*0.65 + (signalCount*4 + riskTagCount*3)`

Then clamped to `0..100`.

### Base uncertainty

`computeBaseUncertainty()` starts at `61` and adjusts based on:

- raw email length
- number of signals
- extracted evidence count
- spread between top two category scores
- top score strength
- thread depth
- thread risk density
- trust score
- reputation score
- whether priority is high
- whether risk tags are absent

Important behavior:

- short/sparse emails raise uncertainty
- more signals and more extracted evidence lower uncertainty
- category ambiguity raises uncertainty
- low trust / low reputation raise uncertainty
- no risk tags raises uncertainty

## Step 16: Trusted decision seed

`buildTrustedDecision()` converts the scored email into a risk/action proposal.

### Risk score base formula

`riskScore = threat*0.62 + trustGap*0.2 + (100-trust)*0.09 + (100-reputation)*0.09`

### Additional risk weights

The route then adds offline-template weights for specific conditions:

- external sender mismatch: `+18`
- urgent language under trust gap / threat conditions: `+12`
- payment request: `+20`
- credential request: `+22`
- suspicious URL mismatch: `+24`
- suspicious attachment: `+20`
- spoofing indicators: `+18`
- low historical trust: `+12`

### Action thresholds

Using offline thresholds from `src/lib/offline/template.ts`:

- `block` at `>= 90`
- `quarantine` at `>= 75`
- `escalate` at `>= 55`
- `allow` otherwise

### Confidence calculation

`confidencePct = (100 - uncertainty) * 0.75 + min(22, riskScore * 0.22)`

Then clamped to `5..99`.

## Step 17: Action guardrails

`applyActionGuardrails()` can override the trusted action.

### Strong spam evidence

If the message looks like strong promotional spam and attachment risk is low:

- `quarantine` or `block` can be reduced to `allow`
- rule: `spam_action_cap`

### Strong harmful evidence

If harmful probability is high plus scam/attachment/URL evidence is strong:

- `allow` or `escalate` can be raised
- rule: `harmful_action_floor`
- final forced action becomes `quarantine` if harmful probability `>= 0.84`, otherwise `escalate`

## Step 18: Offline assist vs model assist

After the first seed decision, the route chooses one of two assist paths.

### Offline assist path

If offline is enforced:

- no remote model is used
- `offlineAssistFromPolicy()` generates a deterministic suggested action and generic reply template
- consensus fields are filled with deterministic placeholders
- disagreement flag: `offline_policy_applied`

### Remote model assist path

If offline is not enforced:

- `llmAssistWithConsensus()` is used

## Step 19: Consensus model pool

The consensus pool is built by `buildConsensusModelPool()`.

### Possible models

If configured, the pool can include:

- OpenAI `gpt-4o-mini`
- OpenAI `gpt-4.1-mini`
- Google `gemini-2.0-flash`
- Anthropic `claude-3-5-haiku-latest`

### Model count behavior

- if consensus is disabled, only 1 model is used
- if consensus is enabled, up to `maxModels` are used

The effective policy comes from:

- environment defaults
- optionally overridden by admin settings cookie

## Step 20: What each assist model sees

Each assist model receives:

- raw email
- sender
- subject
- current priority and priority score
- primary category
- top category scores
- risk tags
- signals
- extracted deadlines, money mentions, URLs, attachments

Each model must return strict JSON with:

- `suggestedAction`
- `draftReply`
- `label`
- `action`
- `confidence`
- `entities[]`

## Step 21: Consensus evaluation

`evaluateConsensusRuns()` compares successful model runs on:

- label agreement
- action agreement
- confidence variance
- entity overlap

### Flags that can be produced

- `label_disagreement`
- `action_disagreement`
- `confidence_variance_high`
- `entity_overlap_low`
- `partial_model_failure`
- `force_escalation_review`

### Special fallback cases

- if no models are configured: `no_models_configured`
- if all models fail: `all_models_failed`

### Consensus strength

`consensus_strength = 0.35*labelAgreement + 0.35*actionAgreement + 0.15*(1-confidenceVariance) + 0.15*entityOverlap`

### Hard disagreement handling

If label or action disagreement is strong enough:

- the route does not trust the anchor output blindly
- it substitutes a conservative verification-oriented action and reply

## Step 22: Uncertainty recalibration

After consensus, the route recalibrates uncertainty with `calibrateUncertainty()`.

### Inputs

- category-specific calibration profile
- base uncertainty
- evidence strength
- trust score
- reputation score
- consensus score
- thread depth

Each category has a calibration profile with:

- `slope`
- `offset`
- `reliabilityWeight`

High-risk scam categories use stronger reliability weights and positive offsets. Newsletter and sales categories use lower reliability weights and negative offsets.

### Disagreement penalty

After calibration, disagreement flags can increase uncertainty further:

- hard disagreement: `+12`
- moderate disagreement: `+6`

## Step 23: Threat type derivation

`deriveThreatType()` maps the primary category and risk tags to a threat type.

Possible threat types:

- `phishing`
- `impersonation`
- `malware`
- `payment_fraud`
- `legal_risk`
- `none`
- `unknown`

Examples:

- `scam_credential_phishing` -> `phishing`
- `scam_impersonation` or `scam_bec` -> `impersonation`
- `scam_malware_attachment` or `Suspicious Attachment` -> `malware`
- `scam_invoice_fraud` or `finance_payment` -> `payment_fraud`
- `legal_contract` -> `legal_risk`

## Step 24: Mail class derivation and reconciliation

The route derives a mail class from category/action/priority, then reconciles it against classifier probabilities.

### Initial derived mail class

Examples:

- newsletter -> `spam`, unless high-priority allow path makes it `informational`
- threat type plus quarantine/block/high priority -> `harmful`
- deadline scheduling and ops support -> `actionable`
- sales marketing -> `actionable` only if higher priority / escalated, else `informational`
- general low priority -> `informational`
- otherwise `actionable` if priority `>= 50`, else `informational`

### Reconciliation rules

`reconcileMailClass()` can override the derived result.

#### Force spam for low-affinity promotions

If promotional, affinity is low, spam probability is meaningful, harmful probability is low, and priority is not high:

- force `spam`
- force threat type `none`
- rule: `force_spam_promotional`

#### Preserve reviewable promotions

If promotional, affinity is high, priority is meaningful, harmful probability is low, and info/actionable probability is meaningful:

- preserve as `informational`
- rule: `preserve_reviewable_promotional`

#### Force harmful

If harmful probability `>= 0.68`:

- force `harmful`
- set threat type to `unknown` if it was `none`
- rule: `force_harmful_high_prob`

#### Promote actionable

If actionable probability `>= 0.55` while current class is informational:

- promote to `actionable`
- rule: `promote_actionable`

#### Demote informational

If informational probability `>= 0.62` while current class is actionable:

- demote to `informational`
- rule: `demote_informational`

## Step 25: Structured signal groups

`buildSignalGroups()` packages the decision inputs into two families.

### Deterministic signals

- top category scores
- risk tags
- signals
- trust score
- reputation score
- reputation findings
- thread depth / risk density
- extracted counts
- guardrail hits and rationale
- decision-importance profile

### Learned signals

- classifier snapshot
- consensus snapshot

This grouping is later stored in incident memory and used for explanation output.

## Step 26: Structured uncertainty

`buildStructuredUncertainty()` converts numeric uncertainty into a structured object.

### Sources calculated

- `model_confidence`
- `signal_conflict`
- `missing_fields`

### Signal conflict sources

Conflict increases when:

- the top two category scores are close together
- classifier prediction differs from final mail class
- disagreement flags indicate label/action disagreement
- confidence variance is high
- entity overlap is low
- partial model failure occurred

### Missing field count increments when

- sender email missing
- sender domain missing
- no URLs
- no attachments
- no deadlines
- no money mentions
- raw email shorter than 170 characters

### Uncertainty types emitted

- `epistemic`
- `conflict`
- `missing_data`

## Step 27: Explanation generation

`buildExplanation()` generates user-facing explanation content from the structured signals.

It builds:

- `keyFactors[]`
- `summary`

The explanation can pull from:

- top category score
- attention type and score mix
- trusted action and risk score
- top risk tags
- trust and reputation values
- attachment/URL counts
- classifier prediction and top probability
- historical affinity
- consensus strength / flags
- uncertainty types and score
- guardrail hits

The summary is intentionally phrased differently for:

- `act_now`
- `verify_now`
- `review_later`
- `ignore_routine`

There are also special summary overrides for:

- high-priority deadline scheduling
- low-priority promotional/newsletter mail

## Step 28: Decision trace

`buildDecisionTrace()` constructs the formal reasoning trail included in each alert.

### Contains

- `policyVersion`
- `modelVersion`
- explanatory sentence string
- `evidenceRefs[]`

Evidence refs are created from:

- top risk tags
- top category scores
- trust score
- reputation score
- thread data
- consensus score

## Step 29: Final routing action

`routeInboxDecision()` is a separate routing layer on top of all earlier work.

This is not the same as the trusted action `allow/escalate/quarantine/block`.

It maps into:

- `auto_triage`
- `escalate`
- `human_review`

### Default thresholds

- auto-triage if confidence `>= 82`, uncertainty `<= 28`, and no moderate disagreement flags
- escalate if confidence `>= 60` or uncertainty `<= 52`
- otherwise human review

### Hard review flags

Any of these force `human_review`:

- `force_escalation_review`
- `label_disagreement`
- `action_disagreement`
- `all_models_failed`
- `not_analyzed_budget_capped`

### Moderate disagreement flags

These do not force human review, but they block auto-triage:

- `confidence_variance_high`
- `entity_overlap_low`
- `partial_model_failure`

### Risk level bands

- `low` if risk score `< 40`
- `medium` if risk score `>= 40`
- `high` if risk score `>= 70`

These are configurable through environment variables.

## Step 30: TOP_N budget cap

When offline is not enforced, the route only sends the top `8` scored emails through full model-assisted analysis.

Behavior:

- `TOP_N = scored.length` when offline enforced
- `TOP_N = min(8, scored.length)` otherwise

For emails outside the top slice:

- no remote draft analysis is run
- consensus fields are populated with placeholders
- disagreement flag becomes `not_analyzed_budget_capped`
- suggested action becomes `No action suggested (not analyzed).`
- draft reply becomes `No reply needed.`

This matters because those emails are still classified and routed, but they are treated more conservatively.

## Step 31: Persistence after the scan

### Trust graph cookie update

Every alert updates sender/domain trust stats in the cookie graph.

### Incident memory persistence

If Mongo is configured, up to 40 alerts are written into `IncidentMemoryModel` with:

- hashes for source/sender/subject
- final class, threat type, trusted action, priority score, consensus score
- uncertainty structure
- deterministic and learned signal groups
- explanation summary and factors
- decision trace evidence refs
- policy/model version
- blank `outcomeLabel` waiting for feedback

### Sender reputation snapshot updates

Up to 60 alerts also update `SenderReputationSnapshotModel` with:

- trust score
- reputation score
- high/medium/low counts
- sample size
- note tags
- last seen timestamp

### Evaluation log persistence

The scanner appends evaluation log entries either to:

- Mongo `InboxEvaluationLogModel` if Mongo is configured
- otherwise `data/inbox/scanner.evaluation.jsonl`

Each evaluation entry includes prediction, confidence, uncertainty, routing action, consensus metadata, source mode, processing mode, versions, and a placeholder ground-truth object.

## Step 32: Feedback learning loop

`POST /api/inbox/feedback` is how user corrections feed back into scanner memory.

### Accepted outcome labels

- `spam_true_positive`
- `spam_false_positive`
- `harmful_true_positive`
- `harmful_false_positive`
- `actionable_correct`
- `informational_correct`

### What feedback can change

- `outcomeLabel`
- optionally corrected mail class
- optionally corrected priority score via low/medium/high mapping
- feedback source label

These updates flow back into later scans through `loadIncidentHints()`.

## Step 33: Admin control over consensus

`/api/inbox/settings` exposes a GET/PATCH API for consensus settings.

Admin override can control:

- `consensusEnabled`
- `consensusMaxModels`

That override is stored in a cookie and wins over env defaults for scanner requests.

## Step 34: Offline behavior summary

Offline runtime is real and changes scanner behavior.

### When offline is enforced

- Gmail fetch may be blocked if outbound networking is disabled
- model version becomes `deterministic-offline-v1`
- assist path becomes deterministic via `offlineAssistFromPolicy()`
- inbox still scores, classifies, and routes mail using deterministic logic
- `/api/plan`, `/api/run`, and `/api/agent` are blocked separately elsewhere because they rely on remote model/web tools

### Important caveat

`src/lib/offline/template.ts` is explicitly described as a template, but the scanner does reuse its thresholds and signal weights when computing trusted decisions.

## Complete list of decision inputs used by the scanner

This is the full practical checklist of what the scanner uses to make decisions or classifications.

### Raw content-derived inputs

- sender header
- subject
- body text
- extracted sender email
- extracted sender domain
- thread ID / derived thread key
- deadlines
- money mentions
- URLs
- URL domains
- attachment names
- attachment risk score
- raw email length

### Pattern-hit inputs

- security hits
- payment hits
- legal hits
- deadline hits
- scheduling hits
- executive hits
- support hits
- impersonation hits
- malware hits
- sales hits
- newsletter hits
- promotional urgency hits
- promotional sender hits
- opportunity-pattern hits
- career-pattern hits

### Environment / state inputs

- offline state
- outbound network block state
- enabled model provider keys
- consensus enabled / max models
- decision routing threshold env vars
- organization allowlist domains

### Historical inputs

- trust graph sender stats
- trust graph domain stats
- incident memory hints
- outcome labels from feedback
- prior priority scores
- sender reputation snapshots

### Derived numerical inputs

- trust score
- reputation score
- thread depth
- thread risk density
- category scores
- decision-importance scores
- classifier probabilities
- evidence strength
- base uncertainty
- calibrated uncertainty
- consensus score / strength
- trusted decision risk score
- final routing risk level

## Practical takeaways

1. The inbox scanner is not a pure LLM classifier.
2. The first pass is mostly deterministic and formula-driven.
3. Model assistance enters after the initial scoring and guardrail layers.
4. Promotions are intentionally suppressed through multiple paths, not one rule.
5. Historical feedback matters in two places: affinity scoring and classifier learned-history terms.
6. The scanner distinguishes three different layers of decision:
   - priority (`high/medium/low`)
   - trusted action (`allow/escalate/quarantine/block`)
   - routing action (`auto_triage/escalate/human_review`)
7. Budget caps and disagreement flags can force review even if the earlier scoring looks decisive.
8. The scanner persists enough structure to be auditable later.

## Suggested next documentation follow-ups

If you want the docs to go deeper after this brief, the next useful documents would be:

- a companion brief for `/api/plan`
- a companion brief for `/api/run`
- a decision-flow diagram for the inbox scanner
- a tuning guide listing every threshold and weight in one table
- an eval guide explaining how to measure false positives, false negatives, and trust calibration
