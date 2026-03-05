# Prompt Firewall v0.3.0

A local-first Chrome extension (MV3) that intercepts GenAI chat sends, detects sensitive data and prompt injections, optionally routes through a configurable proxy chain, and maintains a tamper-evident trust ledger.

## What's New in v0.3.0

### 🔗 Proxy Chain
Route prompts through a configurable chain of HTTP proxy endpoints before they reach the AI. Each hop:
- Receives the (already-redacted) prompt via POST as JSON `{"text":"...","domain":"...","hop_index":N,"transform":"..."}`
- Must return `{"text":"..."}` or `{"result":"..."}`
- Supports per-hop auth headers, configurable timeout, and fail actions (`passthrough` or `abort`)
- Transform modes: `passthrough`, `audit`, `rewrite`, `filter`
- Live test from the Options → Proxy Chain page with per-hop latency and error display

### 🚨 Prompt Injection Detection
Detects adversarial prompt injection patterns before sending:
- `ignore_instructions` — attempts to override prior context
- `role_override` — "act as", "pretend you are", etc.
- `jailbreak_token` — DAN, JAILBREAK, DEV MODE, etc.
- `leak_system_prompt` — attempts to reveal system instructions
- `new_instructions` — injected rule replacement
- `base64_injection` — eval/atob abuse
- `delimit_escape` — code fence escapes
- `indirect_ref` — indirect document injection

Detected injections are logged, shown as a red banner at the top of the page, appear in the block modal, and always escalate the decision to BLOCK (score ≥ 30).

### 🗄 Data Vault
Redacted placeholders (`[EMAIL_1]`, `[API_SECRET_2]`, etc.) are stored locally so you can track what was redacted across sessions. No raw values are ever stored. Viewable in Options → Data Vault.

### 📊 Risk Timeline Sparkline
The popup now displays a canvas sparkline of the last 30 risk scores with color-coded dots (green/amber/red) and injection markers (red ring).

### 📤 Audit Report & Export
Options → Audit provides a full summary: total events, average risk, injection alert count, ledger integrity, action breakdown, top domains and categories. Export as JSON or CSV.

### Extended Detection
New detectors: IPv4 addresses, passport numbers, dates of birth, Anthropic API keys.

## All Features

- **Send interception** — Enter, button click, form submit
- **Sensitive data detection** — Email, phone, SSN, credit card (Luhn), private keys, JWT, AWS/Stripe/Slack/GitHub/Anthropic secrets, IP addresses, passports, DOB, high-entropy generic tokens
- **Redaction** — Structured placeholders, overlap-safe, deduped
- **Adaptive step-up** — ALLOW / AUTO_REDACT / BLOCK decisions
- **Clipboard protection** — Paste sanitization
- **Proxy chain** — Multi-hop routing with auth, transforms, timeouts, fail policies
- **Prompt injection detection** — 8 signal types, risk escalation, UI banner
- **Data Vault** — Local placeholder storage
- **Trust Ledger** — Tamper-evident hash chain (SHA-256), injection metadata included
- **Policy packs** — Student, Healthcare, Legal, Corporate, Custom
- **Domain controls** — Allowlist + strict-mode domains
- **Risk sparkline** — Canvas chart in popup
- **Audit export** — JSON & CSV

## Load Unpacked

1. `chrome://extensions` → Enable Developer Mode
2. Click **Load unpacked**
3. Select `extension/prompt-firewall`

## Proxy Chain: Quick Start

1. Open Options → **Proxy Chain**
2. Click **+ Add Hop**
3. Enter your endpoint URL (must accept POST, return `{"text":"..."}`)
4. Set auth header/value if needed
5. Click **Test Chain** to validate
6. Click **Save Proxy Chain**
7. Toggle **Enable chain** ON

A simple Node.js passthrough proxy example:
```js
app.post('/audit', (req, res) => {
  console.log('Prompt received:', req.body.text);
  res.json({ text: req.body.text }); // passthrough
});
```

## Architecture

All detection and proxy execution runs in the background service worker. The content script only reads/writes DOM and messages the background. No data leaves the browser except through explicitly configured proxy hops.
