const LEDGER_LIMIT = 400;
const STRICT_DEFAULT_DOMAINS = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com",
  "perplexity.ai",
];

const POLICY_PACKS = {
  student: {
    riskBlockThreshold: 78,
    riskAutoRedactThreshold: 38,
    denyOverridesForSecrets: true,
    clipboardProtection: true,
    localOnlyMode: true,
  },
  healthcare: {
    riskBlockThreshold: 62,
    riskAutoRedactThreshold: 24,
    denyOverridesForSecrets: true,
    clipboardProtection: true,
    localOnlyMode: true,
  },
  legal: {
    riskBlockThreshold: 66,
    riskAutoRedactThreshold: 26,
    denyOverridesForSecrets: true,
    clipboardProtection: true,
    localOnlyMode: true,
  },
  corporate: {
    riskBlockThreshold: 70,
    riskAutoRedactThreshold: 30,
    denyOverridesForSecrets: true,
    clipboardProtection: true,
    localOnlyMode: true,
  },
};

const DEFAULT_POLICY = {
  enabled: true,
  policyPack: "corporate",
  riskBlockThreshold: 70,
  riskAutoRedactThreshold: 30,
  allowlistDomains: [],
  strictModeDomains: STRICT_DEFAULT_DOMAINS,
  denyOverridesForSecrets: true,
  clipboardProtection: true,
  localOnlyMode: true,
  holdToConfirmMs: 2000,
  proxyChain: [],
  proxyChainEnabled: false,
};

// ─────────────────────────────────────────────
//  Install / startup
// ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const { policy, ledger } = await chrome.storage.local.get(["policy", "ledger"]);
  if (!policy) {
    await chrome.storage.local.set({ policy: DEFAULT_POLICY, ledger: [] });
    return;
  }
  const normalized = normalizePolicy(policy);
  const next = { policy: normalized };
  if (!Array.isArray(ledger)) next.ledger = [];
  await chrome.storage.local.set(next);
});

// ─────────────────────────────────────────────
//  Message router
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") {
      sendResponse({ ok: false, error: "Invalid message." });
      return;
    }

    // ── Core scan ──────────────────────────────────────────────────────────
    if (msg.type === "CLASSIFY_AND_REDACT") {
      const text = String(msg.payload?.text || "");
      const url  = String(msg.payload?.url  || "");
      const trigger = String(msg.payload?.trigger || "unknown");
      const domain  = safeDomain(url);

      const policy    = await getPolicy();
      const effective = getEffectiveThresholds(policy, domain);

      if (!policy.enabled || domainInList(domain, policy.allowlistDomains)) {
        const analysis = passthrough(text);
        await appendLedger({
          eventType: "scan", domain, trigger,
          risk: 0, categories: [], counts: {}, action: "ALLOW",
          note: !policy.enabled ? "Protection disabled." : "Allowlisted domain bypass.",
        });
        sendResponse({
          ok: true, policy, analysis, decision: { action: "ALLOW", canOverride: true, effectiveThresholds: effective },
          redactedText: text, redactions: [],
          injectionResult: { detected: false, signals: [] },
        });
        return;
      }

      const analysis      = analyzeText(text);
      const injectionResult = detectPromptInjection(text);
      const redacted      = applyRedactions(text, analysis.findings);
      const decision      = decideAction({ analysis, policy, effective, injectionResult });
      const fingerprints  = await hashFindingFingerprints(analysis.findings, 12);

      await appendLedger({
        eventType: "scan", domain, trigger,
        risk: analysis.risk, categories: analysis.categories, counts: analysis.counts,
        redactionCounts: redacted.redactionCounts, action: decision.action,
        canOverride: decision.canOverride, findingFingerprints: fingerprints,
        injectionDetected: injectionResult.detected,
        injectionSignals: injectionResult.signals,
      });

      sendResponse({
        ok: true, policy,
        analysis: {
          risk: analysis.risk, categories: analysis.categories,
          counts: analysis.counts, originalLength: analysis.originalLength,
        },
        decision,
        redactedText: redacted.redactedText,
        redactions: redacted.redactions,
        injectionResult,
      });
      return;
    }

    // ── Safe rewrite ───────────────────────────────────────────────────────
    if (msg.type === "SAFE_REWRITE") {
      const redactedText = String(msg.payload?.redactedText || "");
      const categories   = Array.isArray(msg.payload?.categories) ? msg.payload.categories.map(String) : [];
      sendResponse({ ok: true, rewrittenText: buildSafeRewrite(redactedText, categories) });
      return;
    }

    // ── Proxy chain execute ────────────────────────────────────────────────
    if (msg.type === "PROXY_CHAIN_EXECUTE") {
      const text   = String(msg.payload?.text || "");
      const domain = String(msg.payload?.domain || "unknown");
      const policy = await getPolicy();

      if (!policy.proxyChainEnabled || !Array.isArray(policy.proxyChain) || policy.proxyChain.length === 0) {
        sendResponse({ ok: true, finalText: text, hops: [], skipped: true });
        return;
      }

      const result = await executeProxyChain(text, policy.proxyChain, domain);
      sendResponse({ ok: true, ...result });
      return;
    }

    // ── Proxy chain test ───────────────────────────────────────────────────
    if (msg.type === "PROXY_CHAIN_TEST") {
      const hops = Array.isArray(msg.payload?.hops) ? msg.payload.hops : [];
      const text = String(msg.payload?.text || "test probe");
      const result = await executeProxyChain(text, hops, "test");
      sendResponse({ ok: true, ...result });
      return;
    }

    // ── Data Vault ─────────────────────────────────────────────────────────
    if (msg.type === "VAULT_STORE") {
      const entries = msg.payload?.entries;
      if (!Array.isArray(entries)) { sendResponse({ ok: false, error: "entries must be array" }); return; }
      const { vault } = await chrome.storage.local.get("vault");
      const current = Array.isArray(vault) ? vault : [];
      const ts = Date.now();
      const added = entries.map((e) => ({
        id: crypto.randomUUID(),
        placeholder: String(e.placeholder || ""),
        category: String(e.category || "UNKNOWN"),
        ts,
      }));
      const next = [...added, ...current].slice(0, 500);
      await chrome.storage.local.set({ vault: next });
      sendResponse({ ok: true, stored: added.length });
      return;
    }

    if (msg.type === "VAULT_GET") {
      const { vault } = await chrome.storage.local.get("vault");
      sendResponse({ ok: true, vault: Array.isArray(vault) ? vault.slice(0, 200) : [] });
      return;
    }

    if (msg.type === "VAULT_CLEAR") {
      await chrome.storage.local.set({ vault: [] });
      sendResponse({ ok: true });
      return;
    }

    // ── Ledger ops ─────────────────────────────────────────────────────────
    if (msg.type === "LEDGER_APPEND") {
      const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
      await appendLedger({
        eventType: String(payload.eventType || "user_resolution"),
        domain: String(payload.domain || "unknown"),
        trigger: String(payload.trigger || "unknown"),
        action: String(payload.action || "INFO"),
        risk: Number.isFinite(payload.risk) ? Number(payload.risk) : 0,
        categories: Array.isArray(payload.categories) ? payload.categories.map(String) : [],
        counts: payload.counts && typeof payload.counts === "object" ? payload.counts : {},
        note: typeof payload.note === "string" ? payload.note : "",
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "LEDGER_GET") {
      const { ledger } = await chrome.storage.local.get("ledger");
      const limit = clampInt(msg.payload?.limit, 1, 400, 50);
      sendResponse({ ok: true, ledger: Array.isArray(ledger) ? ledger.slice(0, limit) : [] });
      return;
    }

    if (msg.type === "LEDGER_VERIFY") {
      const { ledger } = await chrome.storage.local.get("ledger");
      sendResponse({ ok: true, ...(await verifyLedger(Array.isArray(ledger) ? ledger : [])) });
      return;
    }

    if (msg.type === "LEDGER_CLEAR") {
      await chrome.storage.local.set({ ledger: [] });
      sendResponse({ ok: true });
      return;
    }

    // ── Audit export ───────────────────────────────────────────────────────
    if (msg.type === "AUDIT_EXPORT") {
      const { ledger, policy } = await chrome.storage.local.get(["ledger", "policy"]);
      const entries = Array.isArray(ledger) ? ledger : [];
      const verify  = await verifyLedger(entries);
      const report  = buildAuditReport(entries, policy || {}, verify);
      sendResponse({ ok: true, report });
      return;
    }

    // ── Policy ops ─────────────────────────────────────────────────────────
    if (msg.type === "POLICY_GET") {
      sendResponse({ ok: true, policy: await getPolicy() });
      return;
    }

    if (msg.type === "POLICY_SET") {
      const next = normalizePolicy(msg.payload?.policy || {});
      await chrome.storage.local.set({ policy: next });
      sendResponse({ ok: true, policy: next });
      return;
    }

    if (msg.type === "POLICY_PACKS_GET") {
      sendResponse({ ok: true, packs: POLICY_PACKS });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${String(msg.type)}` });
  })().catch((err) => {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : "Unhandled extension error." });
  });
  return true;
});

// ─────────────────────────────────────────────
//  Proxy chain engine
// ─────────────────────────────────────────────
async function executeProxyChain(text, hops, domain) {
  const hopResults = [];
  let current = text;

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    if (!hop || typeof hop.url !== "string" || !hop.url.trim()) {
      hopResults.push({ index: i, skipped: true, reason: "no url" });
      continue;
    }

    const hopStart = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (hop.authHeader && hop.authValue) {
        headers[String(hop.authHeader).trim()] = String(hop.authValue).trim();
      }

      const body = JSON.stringify({
        text: current,
        domain,
        hop_index: i,
        hop_total: hops.length,
        transform: hop.transform || "passthrough",
        metadata: hop.metadata || {},
      });

      const timeout = clampInt(hop.timeoutMs, 500, 15000, 5000);
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);

      const resp = await fetch(hop.url.trim(), {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const json = await resp.json();
      // Hop must return { text: "..." } or { result: "..." }
      const next = String(json.text ?? json.result ?? current);
      hopResults.push({
        index: i,
        url: hop.url,
        transform: hop.transform || "passthrough",
        latencyMs: Date.now() - hopStart,
        success: true,
        outputLength: next.length,
      });
      current = next;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      hopResults.push({
        index: i,
        url: hop.url,
        latencyMs: Date.now() - hopStart,
        success: false,
        error: reason,
      });

      if (hop.failAction === "abort") {
        return { finalText: text, hops: hopResults, aborted: true, abortedAt: i };
      }
      // Default: passthrough on failure and continue chain
    }
  }

  return { finalText: current, hops: hopResults, aborted: false };
}

// ─────────────────────────────────────────────
//  Prompt Injection Detection
// ─────────────────────────────────────────────
const INJECTION_PATTERNS = [
  { signal: "ignore_instructions",  regex: /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|context|rules?)/gi },
  { signal: "new_instructions",     regex: /\b(new|updated?|revised?|overriding?)\s+(instructions?|system\s+prompt|rules?|guidelines?|directives?)\b/gi },
  { signal: "role_override",        regex: /\b(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as|your\s+new\s+role\s+is)\b/gi },
  { signal: "jailbreak_token",      regex: /\b(DAN|JAILBREAK|DEV\s*MODE|DEVELOPER\s*MODE|UNRESTRICTED|NO\s*FILTER)\b/g },
  { signal: "leak_system_prompt",   regex: /\b(reveal|output|print|show|display|repeat|tell\s+me|what\s+is)\s+(your\s+)?(system\s+prompt|instructions?|initial\s+prompt|hidden\s+instructions?)\b/gi },
  { signal: "base64_injection",     regex: /\beval\s*\(|base64_decode\s*\(|atob\s*\(/gi },
  { signal: "delimit_escape",       regex: /```[\s\S]{0,20}(ignore|bypass|override|jailbreak)/gi },
  { signal: "indirect_ref",         regex: /\b(from\s+the\s+url|the\s+document\s+says?|according\s+to\s+the\s+(page|file|link))\b.*\b(ignore|bypass|override)\b/gi },
];

const INJECTION_SCORE_MAP = {
  ignore_instructions: 45,
  new_instructions:    35,
  role_override:       30,
  jailbreak_token:     60,
  leak_system_prompt:  40,
  base64_injection:    50,
  delimit_escape:      35,
  indirect_ref:        30,
};

function detectPromptInjection(text) {
  const signals = [];
  let score = 0;

  for (const pattern of INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      signals.push({ signal: pattern.signal, count: matches.length });
      score = Math.min(100, score + (INJECTION_SCORE_MAP[pattern.signal] || 20));
    }
  }

  return {
    detected: signals.length > 0,
    score,
    signals,
  };
}

// ─────────────────────────────────────────────
//  Audit Report Builder
// ─────────────────────────────────────────────
function buildAuditReport(entries, policy, verify) {
  const now = new Date().toISOString();
  const actionCounts = {};
  const domainCounts = {};
  const categoryCounts = {};
  let totalRisk = 0;
  let injectionCount = 0;

  for (const e of entries) {
    actionCounts[e.action] = (actionCounts[e.action] || 0) + 1;
    domainCounts[e.domain] = (domainCounts[e.domain] || 0) + 1;
    for (const cat of e.categories || []) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    totalRisk += Number.isFinite(e.risk) ? e.risk : 0;
    if (e.injectionDetected) injectionCount++;
  }

  return {
    generatedAt: now,
    extensionVersion: "0.3.0",
    ledgerIntegrity: verify,
    summary: {
      totalEvents: entries.length,
      avgRisk: entries.length > 0 ? Math.round(totalRisk / entries.length) : 0,
      actionBreakdown: actionCounts,
      topDomains: Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, c]) => ({ domain: d, count: c })),
      topCategories: Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => ({ category: cat, count })),
      injectionAttemptsDetected: injectionCount,
    },
    policy: {
      pack: policy.policyPack,
      autoRedactThreshold: policy.riskAutoRedactThreshold,
      blockThreshold: policy.riskBlockThreshold,
      proxyChainEnabled: policy.proxyChainEnabled,
      proxyHops: Array.isArray(policy.proxyChain) ? policy.proxyChain.length : 0,
    },
    entries: entries.slice(0, 400),
  };
}

// ─────────────────────────────────────────────
//  Policy helpers
// ─────────────────────────────────────────────
async function getPolicy() {
  const { policy } = await chrome.storage.local.get("policy");
  return normalizePolicy(policy || {});
}

function normalizePolicy(input) {
  const candidate = input && typeof input === "object" ? input : {};
  const requestedPack = String(candidate.policyPack || DEFAULT_POLICY.policyPack);
  const policyPack =
    requestedPack === "custom" || Object.prototype.hasOwnProperty.call(POLICY_PACKS, requestedPack)
      ? requestedPack
      : DEFAULT_POLICY.policyPack;
  const pack = POLICY_PACKS[policyPack] || {};
  const merged = { ...DEFAULT_POLICY, ...pack, ...candidate, policyPack };

  const blockThreshold = clampInt(merged.riskBlockThreshold, 1, 100, DEFAULT_POLICY.riskBlockThreshold);
  const autoThreshold  = Math.min(
    clampInt(merged.riskAutoRedactThreshold, 1, 100, DEFAULT_POLICY.riskAutoRedactThreshold),
    Math.max(1, blockThreshold - 1)
  );

  // Normalize proxy chain
  const rawChain = Array.isArray(merged.proxyChain) ? merged.proxyChain : [];
  const proxyChain = rawChain.map((hop) => ({
    url: String(hop.url || "").trim(),
    authHeader: String(hop.authHeader || ""),
    authValue: String(hop.authValue || ""),
    transform: String(hop.transform || "passthrough"),
    timeoutMs: clampInt(hop.timeoutMs, 500, 15000, 5000),
    failAction: ["abort", "passthrough"].includes(hop.failAction) ? hop.failAction : "passthrough",
    label: String(hop.label || `Hop ${rawChain.indexOf(hop) + 1}`),
    metadata: hop.metadata && typeof hop.metadata === "object" ? hop.metadata : {},
  }));

  return {
    enabled: Boolean(merged.enabled),
    policyPack,
    riskBlockThreshold: blockThreshold,
    riskAutoRedactThreshold: autoThreshold,
    allowlistDomains: normalizeDomainList(merged.allowlistDomains),
    strictModeDomains: normalizeDomainList(merged.strictModeDomains).length
      ? normalizeDomainList(merged.strictModeDomains)
      : [...STRICT_DEFAULT_DOMAINS],
    denyOverridesForSecrets: Boolean(merged.denyOverridesForSecrets),
    clipboardProtection: Boolean(merged.clipboardProtection),
    localOnlyMode: Boolean(merged.localOnlyMode),
    holdToConfirmMs: clampInt(merged.holdToConfirmMs, 800, 7000, DEFAULT_POLICY.holdToConfirmMs),
    proxyChain,
    proxyChainEnabled: Boolean(merged.proxyChainEnabled),
  };
}

function normalizeDomainList(value) {
  if (!Array.isArray(value)) return [];
  const out = new Set();
  for (const item of value) {
    const d = String(item || "").trim().toLowerCase();
    if (d) out.add(stripPort(d));
  }
  return Array.from(out);
}

function stripPort(domain) { return domain.split(":")[0]; }

function domainInList(domain, list) {
  if (!domain || !Array.isArray(list) || list.length === 0) return false;
  const clean = domain.toLowerCase();
  return list.some((c) => { const cd = String(c || "").toLowerCase(); return clean === cd || clean.endsWith(`.${cd}`); });
}

function getEffectiveThresholds(policy, domain) {
  const strict = domainInList(domain, policy.strictModeDomains);
  if (!strict) return { block: policy.riskBlockThreshold, autoRedact: policy.riskAutoRedactThreshold, strict };
  return { block: Math.max(40, policy.riskBlockThreshold - 10), autoRedact: Math.max(12, policy.riskAutoRedactThreshold - 8), strict };
}

function safeDomain(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return "unknown"; }
}

function passthrough(text) {
  return { risk: 0, categories: [], counts: {}, findings: [], originalLength: text.length };
}

function decideAction({ analysis, policy, effective, injectionResult }) {
  const categories = analysis.categories || [];
  const hasHardSecret =
    categories.includes("PRIVATE_KEY") || categories.includes("SECRET") || categories.includes("JWT");

  let action = "ALLOW";
  if (analysis.risk >= effective.block) action = "BLOCK";
  else if (analysis.risk >= effective.autoRedact) action = "AUTO_REDACT";

  if (hasHardSecret && analysis.risk >= effective.autoRedact) {
    action = action === "ALLOW" ? "AUTO_REDACT" : action;
  }

  // Injection always escalates to BLOCK
  if (injectionResult && injectionResult.detected && injectionResult.score >= 30) {
    action = "BLOCK";
  }

  const canOverride = !(hasHardSecret && policy.denyOverridesForSecrets);
  return { action, canOverride, effectiveThresholds: effective };
}

// ─────────────────────────────────────────────
//  Ledger
// ─────────────────────────────────────────────
async function appendLedger(entry) {
  const { ledger } = await chrome.storage.local.get("ledger");
  const current = Array.isArray(ledger) ? ledger : [];

  const baseEntry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    domain: String(entry.domain || "unknown"),
    trigger: String(entry.trigger || "unknown"),
    eventType: String(entry.eventType || "scan"),
    action: String(entry.action || "INFO"),
    risk: Number.isFinite(entry.risk) ? Number(entry.risk) : 0,
    categories: Array.isArray(entry.categories) ? entry.categories.map(String) : [],
    counts: entry.counts && typeof entry.counts === "object" ? entry.counts : {},
    redactionCounts: entry.redactionCounts && typeof entry.redactionCounts === "object" ? entry.redactionCounts : {},
    canOverride: typeof entry.canOverride === "boolean" ? entry.canOverride : undefined,
    note: typeof entry.note === "string" ? entry.note : "",
    findingFingerprints: Array.isArray(entry.findingFingerprints) ? entry.findingFingerprints : [],
    injectionDetected: Boolean(entry.injectionDetected),
    injectionSignals: Array.isArray(entry.injectionSignals) ? entry.injectionSignals : [],
  };

  const prevHash  = current.length > 0 ? String(current[0].entryHash || "") : "GENESIS";
  const hashInput = stableStringify({ ...baseEntry, prevHash });
  const entryHash = await sha256Hex(`${prevHash}|${hashInput}`);
  const next      = [{ ...baseEntry, prevHash, entryHash }, ...current].slice(0, LEDGER_LIMIT);
  await chrome.storage.local.set({ ledger: next });
}

async function verifyLedger(entries) {
  let valid = true;
  let brokenAtIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prev  = entries[i + 1];
    if (prev && entry.prevHash !== prev.entryHash) { valid = false; brokenAtIndex = i; break; }
    const clone = { ...entry };
    delete clone.entryHash;
    const recomputed = await sha256Hex(`${clone.prevHash}|${stableStringify(clone)}`);
    if (recomputed !== entry.entryHash) { valid = false; brokenAtIndex = i; break; }
  }
  return { valid, brokenAtIndex, checked: entries.length };
}

async function hashFindingFingerprints(findings, limit) {
  const capped = Array.isArray(findings) ? findings.slice(0, limit) : [];
  const out = [];
  for (const f of capped) {
    out.push({ category: String(f.category || "UNKNOWN"), spanHash: await sha256Hex(String(f.match || "")) });
  }
  return out;
}

// ─────────────────────────────────────────────
//  Crypto / utils
// ─────────────────────────────────────────────
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ─────────────────────────────────────────────
//  Detection Engine (unchanged + expanded)
// ─────────────────────────────────────────────
const DETECTORS = [
  { category: "EMAIL",       regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { category: "PHONE",       regex: /\b(?:\+?\d{1,2}[-.\\s]?)?(?:\(?\d{3}\)?[-.\\s]?)\d{3}[-.\\s]?\d{4}\b/g },
  { category: "SSN",         regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { category: "SECRET",      regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { category: "SECRET",      regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { category: "SECRET",      regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { category: "SECRET",      regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { category: "SECRET",      regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { category: "SECRET",      regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { category: "SECRET",      regex: /\bANTH[A-Za-z0-9\-_]{40,}\b/g },
  { category: "JWT",         regex: /\beyJ[A-Za-z0-9\-_]+?\.[A-Za-z0-9\-_]+?\.[A-Za-z0-9\-_]+\b/g },
  { category: "PRIVATE_KEY", regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g },
  { category: "ADDRESS",     regex: /\b\d{1,5}\s+[A-Za-z0-9.\- ]+\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi },
  { category: "IP_ADDRESS",  regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
  { category: "PASSPORT",    regex: /\b[A-Z]{1,2}[0-9]{6,9}\b/g },
  { category: "DATE_OF_BIRTH", regex: /\b(?:DOB|date\s+of\s+birth|born\s+on)\s*:?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi },
];

const GENERIC_TOKEN_REGEX = /\b[A-Za-z0-9+/_=-]{24,}\b/g;
const CREDIT_CARD_REGEX   = /\b(?:\d[ -]*?){13,19}\b/g;

const CATEGORY_WEIGHTS = {
  PRIVATE_KEY: 100, SECRET: 80, JWT: 80, SSN: 70, FINANCIAL: 70,
  PASSPORT: 60, IP_ADDRESS: 30, ADDRESS: 20, DATE_OF_BIRTH: 25, PHONE: 15, EMAIL: 15,
};

function analyzeText(text) {
  const findings = [];

  for (const detector of DETECTORS) {
    addRegexFindings(findings, detector.category, detector.regex, text);
  }

  for (const match of text.matchAll(CREDIT_CARD_REGEX)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const normalized = match[0].replace(/[ -]/g, "");
    if (normalized.length < 13 || normalized.length > 19) continue;
    if (!luhnCheck(normalized)) continue;
    findings.push({ category: "FINANCIAL", start, end: start + match[0].length, match: match[0] });
  }

  for (const match of text.matchAll(GENERIC_TOKEN_REGEX)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const token = match[0];
    if (!looksLikeSecret(token, text, start)) continue;
    findings.push({ category: "SECRET", start, end: start + token.length, match: token });
  }

  const deduped    = dedupeFindings(findings);
  const counts     = countFindings(deduped);
  const categories = Object.keys(counts).sort((a, b) => (CATEGORY_WEIGHTS[b] || 0) - (CATEGORY_WEIGHTS[a] || 0));
  const risk       = scoreRisk(counts);

  return { risk, categories, counts, findings: deduped, originalLength: text.length };
}

function addRegexFindings(bucket, category, regex, text) {
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    bucket.push({ category, start, end: start + match[0].length, match: match[0] });
  }
}

function dedupeFindings(findings) {
  const sorted = [...findings].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const wa = CATEGORY_WEIGHTS[a.category] || 0;
    const wb = CATEGORY_WEIGHTS[b.category] || 0;
    if (wa !== wb) return wb - wa;
    return (b.end - b.start) - (a.end - a.start);
  });
  const kept = [];
  for (const finding of sorted) {
    const overlapIndex = kept.findIndex((k) => overlaps(k, finding));
    if (overlapIndex === -1) { kept.push(finding); continue; }
    const existing = kept[overlapIndex];
    const ew = CATEGORY_WEIGHTS[existing.category] || 0;
    const nw = CATEGORY_WEIGHTS[finding.category] || 0;
    if (nw > ew || (nw === ew && (finding.end - finding.start) > (existing.end - existing.start))) {
      kept[overlapIndex] = finding;
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

function countFindings(findings) {
  const counts = {};
  for (const f of findings) counts[f.category] = (counts[f.category] || 0) + 1;
  return counts;
}

function scoreRisk(counts) {
  let score = 0;
  for (const [category, count] of Object.entries(counts)) {
    const weight = CATEGORY_WEIGHTS[category] || 10;
    const safeCount = Math.max(0, Number(count) || 0);
    if (!safeCount) continue;
    score += weight;
    if (safeCount > 1) score += Math.min(weight * 0.6, (safeCount - 1) * (weight * 0.25));
  }
  return Math.min(100, Math.round(score));
}

function looksLikeSecret(token, text, idx) {
  if (token.length < 24) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^[A-Za-z]+$/.test(token) && token.length < 40) return false;
  const entropy = shannonEntropy(token);
  const near = text.slice(Math.max(0, idx - 28), Math.min(text.length, idx + token.length + 28)).toLowerCase();
  const hint = /\b(api|key|token|secret|passwd|password|bearer|auth|credential)\b/.test(near);
  const mixedCharset = hasMixedCharset(token);
  if (hint && entropy >= 3.0 && mixedCharset) return true;
  if (token.length >= 32 && entropy >= 3.6 && mixedCharset) return true;
  return false;
}

function hasMixedCharset(token) {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(token)).length;
  return classes >= 3;
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let e = 0;
  for (const c of counts.values()) { const p = c / value.length; e -= p * Math.log2(p); }
  return e;
}

function luhnCheck(numStr) {
  let sum = 0; let alternate = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = numStr.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alternate = !alternate;
  }
  return sum % 10 === 0;
}

function applyRedactions(text, findings) {
  const safeFindings = dedupeFindings(Array.isArray(findings) ? findings : []);
  const redactions = []; const redactionCounts = {}; const tokenMap = new Map(); const serialByCategory = {};
  let cursor = 0; let out = "";
  for (const finding of safeFindings) {
    out += text.slice(cursor, finding.start);
    const key = `${finding.category}:${finding.match}`;
    if (!tokenMap.has(key)) {
      serialByCategory[finding.category] = (serialByCategory[finding.category] || 0) + 1;
      tokenMap.set(key, placeholderFor(finding.category, serialByCategory[finding.category]));
    }
    const replacement = tokenMap.get(key);
    out += replacement;
    redactions.push({ category: finding.category, start: finding.start, end: finding.end, replacement });
    redactionCounts[finding.category] = (redactionCounts[finding.category] || 0) + 1;
    cursor = finding.end;
  }
  out += text.slice(cursor);
  return { redactedText: out, redactions, redactionCounts };
}

function placeholderFor(category, idx) {
  const map = {
    EMAIL: `[EMAIL_${idx}]`, PHONE: `[PHONE_${idx}]`, SSN: `[SSN_${idx}]`,
    FINANCIAL: `[CARD_${idx}]`, PRIVATE_KEY: `[PRIVATE_KEY_REDACTED_${idx}]`,
    SECRET: `[API_SECRET_${idx}]`, JWT: `[JWT_${idx}]`, ADDRESS: `[ADDRESS_${idx}]`,
    IP_ADDRESS: `[IP_${idx}]`, PASSPORT: `[PASSPORT_${idx}]`,
    DATE_OF_BIRTH: `[DOB_${idx}]`,
  };
  return map[category] || `[REDACTED_${idx}]`;
}

function buildSafeRewrite(redactedText, categories) {
  return [
    "Rewrite this request safely for an AI assistant.",
    "Rules:", "- Keep placeholders exactly as-is.",
    "- Do not ask for or infer hidden secret values.",
    "- Provide a concise, practical answer that works with redacted data.",
    "", `Detected categories: ${categories.join(", ") || "none"}`, "",
    "Sanitized request:", redactedText,
  ].join("\n");
}
