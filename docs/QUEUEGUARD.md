# Aegis QueueGuard (Hackathon MVP)

## What it is
Aegis QueueGuard is a sandbox demo of a next-gen CAPTCHA + adaptive MFA system for high-demand ticket onsales.
It uses privacy-preserving behavioral signals to compute a risk score and triggers step-up verification only when risk is elevated.
Every decision is logged to an auditable Trust Ledger (tamper-evident hash chain).

## Architecture (ASCII)
Browser UI (Queue Simulator)
  - Derived behavioral signals (velocity, timing uniformity, replay, etc.)
  - Risk Engine (deterministic scoring + explainable factors)
  - Step-up Challenge (L1 Hold-to-confirm, L2 OTP demo)
  - Trust Ledger (append-only, no raw content, hash-chained)

## Step-up Logic
- L0: ALLOW (no challenge)
- L1: STEP_UP with Hold-to-confirm (2 seconds, keyboard accessible)
- L2: STEP_UP/THROTTLE/BLOCK with OTP (demo MFA)
- Decisions are based on risk thresholds defined per policy preset:
  - Fan-first / Strict / Accessibility-first

## Risk Signals (privacy-safe)
Implemented signals:
- Velocity anomaly (actions/sec)
- Timing uniformity (robotic intervals)
- Replay pattern (repeating sequences)
- Navigation anomaly (checkout without join)
- Multi-tab burst (simulated)
- Token reuse (simulated)
- UA flip (simulated)
- Challenge failure rate (derived)

## Privacy & Data Minimization
- No demographics, no location, no biometrics
- No raw typed text or page content stored
- Ledger stores only derived signals, risk score, decision, and top factor keys

## Accessibility
- No image CAPTCHA
- Hold-to-confirm supports keyboard (Space/Enter)
- OTP flow is keyboard-first

## Threat model (short)
- Bot automation, scripted bursts, replay attacks, farmed CAPTCHAs
Mitigations:
- Risk scoring on behavior patterns
- Step-up verification only when needed
- Throttle/block at high risk
- Tamper-evident audit trail

## 3-minute Demo Script
1) Open /queueguard
2) Click "Normal Fan Flow"
   - Show: ALLOW, low risk, no challenge
3) Click "Bot Burst Attack"
   - Show: risk spikes, step-up L2 triggers (OTP)
4) Show Trust Ledger
   - Point to top factors (velocity, replay, token reuse)
   - Point to "no PII stored" transparency panel
5) Switch mode to Accessibility-first and rerun Suspicious User flow
   - Show: fewer hard blocks, more clear step-up

## Q&A bullets
- Why not image CAPTCHA? Accessibility + bypassable; we use adaptive, explainable behavior signals.
- How is it privacy-first? Derived signals only; no raw user content stored.
- What about false positives? Fan-first policy + friction budget; step-up rather than blocking.
- Can bots adapt? Step-up is dynamic; replay/velocity/timing signals + rate limiting/throttle reduce effectiveness.
- Is AI real? "AI" here means behavior anomaly detection + risk modeling, not LLM guesses.
