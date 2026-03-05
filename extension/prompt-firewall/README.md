# Prompt Firewall (Chrome Extension, MV3)

Prompt Firewall is a local-first browser extension that intercepts GenAI chat sends, detects sensitive data, redacts it, and applies adaptive step-up controls with a tamper-evident trust ledger.

## Implemented Features

- Manifest V3 extension with:
  - `content_script.js`
  - `background.js` (service worker)
  - `popup.html` + `popup.js`
  - `options.html` + `options.js`
  - `styles.css`
- Send interception:
  - Enter-to-send in editable chat inputs
  - Send button clicks
  - Form submit hooks
- Sensitive-data detection engine:
  - Regex for email, phone, SSN, cards (with Luhn), private keys, JWT, common API token formats
  - Secret-likelihood heuristic (entropy + context hints)
  - Category-based risk scoring (0-100)
- Redaction:
  - Structured placeholders (`[EMAIL_1]`, `[API_SECRET_1]`, etc.)
  - Overlap-safe replacement engine
- Adaptive step-up:
  - Decision states: `ALLOW`, `AUTO_REDACT`, `BLOCK`
  - Hold-to-confirm override for blocked sends
  - Policy switch to deny overrides for secret categories
- Clipboard protection:
  - Paste sanitization for risky content in chat inputs
- Trust Ledger:
  - No raw sensitive text persisted
  - Stores risk/action/category metadata and optional hashed finding fingerprints
  - Tamper-evident chain (`prevHash`, `entryHash`)
- Domain-aware controls:
  - Allowlist domains
  - Strict mode domains (lower thresholds)
- Policy packs:
  - Student, Healthcare, Legal, Corporate, Custom
- Safe rewrite:
  - Local deterministic rewrite scaffold (`Send redacted + safe rewrite`)

## Load Unpacked

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `extension/prompt-firewall`.

## Hackathon Demo Path

1. Open an AI chat site (`chat.openai.com`, `chatgpt.com`, `gemini.google.com`, etc.).
2. Paste test secrets (AWS key/private key/SSN/card).
3. Attempt send:
   - Medium risk => auto-redaction and send.
   - High risk => block modal with redacted preview + step-up.
4. Open popup:
   - Verify latest events and ledger integrity.
5. Open options:
   - Toggle pack/thresholds and strict domains.

## Notes

- All processing is local to extension runtime.
- `localOnlyMode` is currently policy metadata and safe rewrite remains deterministic/local.
- Add site-specific selectors in `content_script.js` to maximize reliability per target chat UI.
