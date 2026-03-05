const LEDGER_LIMIT = 400;
const VAULT_LIMIT = 500;
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
  injectionBlockThreshold: 30,
  allowlistDomains: [],
  strictModeDomains: STRICT_DEFAULT_DOMAINS,
  denyOverridesForSecrets: true,
  clipboardProtection: true,
  localOnlyMode: true,
  holdToConfirmMs: 2000,
  proxyChainEnabled: false,
  proxyChain: [],
};

chrome.runtime.onInstalled.addListener(async () => {
  const { policy, ledger, vault } = await chrome.storage.local.get(["policy", "ledger", "vault"]);

  if (!policy) {
    await chrome.storage.local.set({
      policy: DEFAULT_POLICY,
      ledger: [],
      vault: [],
    });
    return;
  }

  const normalized = normalizePolicy(policy);
  const next = {
    policy: normalized,
  };
  if (!Array.isArray(ledger)) next.ledger = [];
  if (!Array.isArray(vault)) next.vault = [];
  await chrome.storage.local.set(next);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") {
      sendResponse({ ok: false, error: "Invalid message." });
      return;
    }

    if (msg.type === "CLASSIFY_AND_REDACT") {
      const text = String(msg.payload?.text || "");
      const url = String(msg.payload?.url || "");
      const trigger = String(msg.payload?.trigger || "unknown");
      const domain = safeDomain(url);

      const policy = await getPolicy();
      const effective = getEffectiveThresholds(policy, domain);

      if (!policy.enabled || domainInList(domain, policy.allowlistDomains)) {
        const analysis = passthrough(text);
        await appendLedger({
          eventType: "scan",
          domain,
          trigger,
          risk: 0,
          categories: [],
          counts: {},
          action: "ALLOW",
          note: !policy.enabled ? "Protection disabled by policy." : "Allowlisted domain bypass.",
        });
        sendResponse({
          ok: true,
          policy,
          analysis,
          decision: {
            action: "ALLOW",
            canOverride: true,
            effectiveThresholds: effective,
          },
          redactedText: text,
          redactions: [],
        });
        return;
      }

      const analysis = analyzeText(text);
      const redacted = applyRedactions(text, analysis.findings);
      const decision = decideAction({
        analysis,
        policy,
        effective,
      });
      await appendVaultEntries(redacted.vaultCandidates, domain);
      const fingerprints = await hashFindingFingerprints(analysis.findings, 12);

      await appendLedger({
        eventType: "scan",
        domain,
        trigger,
        risk: analysis.risk,
        categories: analysis.categories,
        counts: analysis.counts,
        redactionCounts: redacted.redactionCounts,
        action: decision.action,
        canOverride: decision.canOverride,
        findingFingerprints: fingerprints,
        injection: analysis.injection,
      });

      sendResponse({
        ok: true,
        policy,
        analysis: {
          risk: analysis.risk,
          categories: analysis.categories,
          counts: analysis.counts,
          originalLength: analysis.originalLength,
          injection: analysis.injection,
        },
        decision,
        redactedText: redacted.redactedText,
        redactions: redacted.redactions,
      });
      return;
    }

    if (msg.type === "SAFE_REWRITE") {
      const redactedText = String(msg.payload?.redactedText || "");
      const categories = Array.isArray(msg.payload?.categories)
        ? msg.payload.categories.map((c) => String(c))
        : [];
      const rewrittenText = buildSafeRewrite(redactedText, categories);
      sendResponse({ ok: true, rewrittenText });
      return;
    }

    if (msg.type === "PROXY_CHAIN_PROCESS") {
      const text = String(msg.payload?.text || "");
      const url = String(msg.payload?.url || "");
      const mode = String(msg.payload?.mode || "send");
      const policy = await getPolicy();
      const domain = safeDomain(url);
      const proxied = await runProxyChain({
        text,
        policy,
        metadata: { domain, url, mode },
      });

      await appendLedger({
        eventType: "proxy_chain",
        domain,
        trigger: mode,
        action: proxied.ok ? "PROXY_CHAIN_OK" : "PROXY_CHAIN_FAIL",
        risk: 0,
        categories: [],
        counts: {},
        note: proxied.ok
          ? `Proxy chain processed with ${proxied.hops.length} hop(s).`
          : `Proxy chain failed: ${proxied.error || "unknown error"}`,
        proxyChain: {
          enabled: policy.proxyChainEnabled,
          hops: proxied.hops,
          finalLength: proxied.text.length,
          ok: proxied.ok,
          aborted: proxied.aborted,
        },
      });

      sendResponse({
        ok: proxied.ok,
        text: proxied.text,
        hops: proxied.hops,
        aborted: proxied.aborted,
        error: proxied.error,
      });
      return;
    }

    if (msg.type === "PROXY_CHAIN_TEST") {
      const payloadPolicy = normalizePolicy(msg.payload?.policy || (await getPolicy()));
      const sampleText = String(
        msg.payload?.sampleText || "Test prompt for proxy-chain diagnostics."
      );
      const proxied = await runProxyChain({
        text: sampleText,
        policy: payloadPolicy,
        metadata: {
          domain: "options.local",
          url: "chrome-extension://options",
          mode: "test",
        },
      });
      sendResponse({
        ok: proxied.ok,
        text: proxied.text,
        hops: proxied.hops,
        aborted: proxied.aborted,
        error: proxied.error,
      });
      return;
    }

    if (msg.type === "LEDGER_APPEND") {
      const payload = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
      await appendLedger({
        eventType: String(payload.eventType || "user_resolution"),
        domain: String(payload.domain || "unknown"),
        trigger: String(payload.trigger || "unknown"),
        action: String(payload.action || "INFO"),
        risk: Number.isFinite(payload.risk) ? Number(payload.risk) : 0,
        categories: Array.isArray(payload.categories) ? payload.categories.map((c) => String(c)) : [],
        counts: payload.counts && typeof payload.counts === "object" ? payload.counts : {},
        note: typeof payload.note === "string" ? payload.note : "",
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "LEDGER_GET") {
      const { ledger } = await chrome.storage.local.get("ledger");
      const limit = clampInt(msg.payload?.limit, 1, 200, 50);
      const entries = Array.isArray(ledger) ? ledger.slice(0, limit) : [];
      sendResponse({ ok: true, ledger: entries });
      return;
    }

    if (msg.type === "LEDGER_EXPORT") {
      const { ledger } = await chrome.storage.local.get("ledger");
      const entries = Array.isArray(ledger) ? ledger : [];
      sendResponse({ ok: true, ledger: entries });
      return;
    }

    if (msg.type === "LEDGER_VERIFY") {
      const { ledger } = await chrome.storage.local.get("ledger");
      const result = await verifyLedger(Array.isArray(ledger) ? ledger : []);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (msg.type === "LEDGER_CLEAR") {
      await chrome.storage.local.set({ ledger: [] });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "VAULT_GET") {
      const { vault } = await chrome.storage.local.get("vault");
      sendResponse({ ok: true, vault: Array.isArray(vault) ? vault : [] });
      return;
    }

    if (msg.type === "VAULT_CLEAR") {
      await chrome.storage.local.set({ vault: [] });
      sendResponse({ ok: true });
      return;
    }

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
      sendResponse({
        ok: true,
        packs: POLICY_PACKS,
      });
      return;
    }

    if (msg.type === "AUDIT_REPORT_GET") {
      const { ledger } = await chrome.storage.local.get("ledger");
      const entries = Array.isArray(ledger) ? ledger : [];
      const integrity = await verifyLedger(entries);
      sendResponse({
        ok: true,
        report: buildAuditReport(entries, integrity),
      });
      return;
    }

    sendResponse({ ok: false, error: `Unknown message type: ${String(msg.type)}` });
  })().catch((err) => {
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : "Unhandled extension error.",
    });
  });

  return true;
});

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

  const merged = {
    ...DEFAULT_POLICY,
    ...pack,
    ...candidate,
    policyPack,
  };

  const blockThreshold = clampInt(merged.riskBlockThreshold, 1, 100, DEFAULT_POLICY.riskBlockThreshold);
  const autoThreshold = Math.min(
    clampInt(merged.riskAutoRedactThreshold, 1, 100, DEFAULT_POLICY.riskAutoRedactThreshold),
    Math.max(1, blockThreshold - 1)
  );

  return {
    enabled: Boolean(merged.enabled),
    policyPack: String(merged.policyPack || DEFAULT_POLICY.policyPack),
    riskBlockThreshold: blockThreshold,
    riskAutoRedactThreshold: autoThreshold,
    injectionBlockThreshold: clampInt(
      merged.injectionBlockThreshold,
      1,
      100,
      DEFAULT_POLICY.injectionBlockThreshold
    ),
    allowlistDomains: normalizeDomainList(merged.allowlistDomains),
    strictModeDomains: normalizeDomainList(merged.strictModeDomains).length
      ? normalizeDomainList(merged.strictModeDomains)
      : [...STRICT_DEFAULT_DOMAINS],
    denyOverridesForSecrets: Boolean(merged.denyOverridesForSecrets),
    clipboardProtection: Boolean(merged.clipboardProtection),
    localOnlyMode: Boolean(merged.localOnlyMode),
    holdToConfirmMs: clampInt(merged.holdToConfirmMs, 800, 7000, DEFAULT_POLICY.holdToConfirmMs),
    proxyChainEnabled: Boolean(merged.proxyChainEnabled),
    proxyChain: normalizeProxyChain(merged.proxyChain),
  };
}

function normalizeProxyChain(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, idx) => {
      const hop = item && typeof item === "object" ? item : {};
      const url = String(hop.url || "").trim();
      if (!url) return null;
      return {
        id: String(hop.id || crypto.randomUUID()),
        name: String(hop.name || `Hop ${idx + 1}`).slice(0, 80),
        url,
        authHeader: String(hop.authHeader || "").trim(),
        authValue: String(hop.authValue || ""),
        transform: normalizeTransform(hop.transform),
        failPolicy: normalizeFailPolicy(hop.failPolicy),
        timeoutMs: clampInt(hop.timeoutMs, 500, 15000, 3500),
        enabled: hop.enabled !== false,
      };
    })
    .filter(Boolean);
}

function normalizeTransform(transform) {
  const v = String(transform || "passthrough").toLowerCase();
  if (["passthrough", "audit", "rewrite", "filter"].includes(v)) return v;
  return "passthrough";
}

function normalizeFailPolicy(policy) {
  return String(policy || "continue").toLowerCase() === "abort" ? "abort" : "continue";
}

function normalizeDomainList(value) {
  if (!Array.isArray(value)) return [];
  const out = new Set();
  for (const item of value) {
    const d = String(item || "").trim().toLowerCase();
    if (!d) continue;
    out.add(stripPort(d));
  }
  return Array.from(out);
}

function stripPort(domain) {
  return domain.split(":")[0];
}

function domainInList(domain, list) {
  if (!domain || !Array.isArray(list) || list.length === 0) return false;
  const clean = domain.toLowerCase();
  return list.some((candidate) => {
    const c = String(candidate || "").toLowerCase();
    if (!c) return false;
    return clean === c || clean.endsWith(`.${c}`);
  });
}

function getEffectiveThresholds(policy, domain) {
  const strict = domainInList(domain, policy.strictModeDomains);
  if (!strict) {
    return {
      block: policy.riskBlockThreshold,
      autoRedact: policy.riskAutoRedactThreshold,
      strict,
    };
  }
  return {
    block: Math.max(40, policy.riskBlockThreshold - 10),
    autoRedact: Math.max(12, policy.riskAutoRedactThreshold - 8),
    strict,
  };
}

function safeDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

function passthrough(text) {
  return {
    risk: 0,
    categories: [],
    counts: {},
    findings: [],
    originalLength: text.length,
  };
}

function decideAction({ analysis, policy, effective }) {
  const categories = analysis.categories || [];
  const hasHardSecret =
    categories.includes("PRIVATE_KEY") ||
    categories.includes("SECRET") ||
    categories.includes("JWT");
  const injectionScore = analysis.injection?.score || 0;
  const hasInjection = injectionScore > 0;

  let action = "ALLOW";
  if (analysis.risk >= effective.block) action = "BLOCK";
  else if (analysis.risk >= effective.autoRedact) action = "AUTO_REDACT";
  if (hasInjection && injectionScore >= policy.injectionBlockThreshold) action = "BLOCK";

  if (hasHardSecret && analysis.risk >= effective.autoRedact) {
    action = action === "ALLOW" ? "AUTO_REDACT" : action;
  }

  const canOverride = !(hasHardSecret && policy.denyOverridesForSecrets) && !hasInjection;

  return {
    action,
    canOverride,
    effectiveThresholds: effective,
    injectionScore,
  };
}

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
    categories: Array.isArray(entry.categories) ? entry.categories.map((c) => String(c)) : [],
    counts: entry.counts && typeof entry.counts === "object" ? entry.counts : {},
    redactionCounts:
      entry.redactionCounts && typeof entry.redactionCounts === "object" ? entry.redactionCounts : {},
    canOverride: typeof entry.canOverride === "boolean" ? entry.canOverride : undefined,
    note: typeof entry.note === "string" ? entry.note : "",
    findingFingerprints: Array.isArray(entry.findingFingerprints) ? entry.findingFingerprints : [],
    injection:
      entry.injection && typeof entry.injection === "object"
        ? {
            score: Number.isFinite(entry.injection.score) ? Number(entry.injection.score) : 0,
            signals: Array.isArray(entry.injection.signals) ? entry.injection.signals : [],
          }
        : { score: 0, signals: [] },
    proxyChain:
      entry.proxyChain && typeof entry.proxyChain === "object"
        ? {
            enabled: Boolean(entry.proxyChain.enabled),
            ok: Boolean(entry.proxyChain.ok),
            aborted: Boolean(entry.proxyChain.aborted),
            finalLength: clampInt(entry.proxyChain.finalLength, 0, 200000, 0),
            hops: Array.isArray(entry.proxyChain.hops) ? entry.proxyChain.hops.slice(0, 20) : [],
          }
        : { enabled: false, ok: true, aborted: false, finalLength: 0, hops: [] },
  };

  const prevHash = current.length > 0 ? String(current[0].entryHash || "") : "GENESIS";
  const hashInput = stableStringify({
    ...baseEntry,
    prevHash,
  });
  const entryHash = await sha256Hex(`${prevHash}|${hashInput}`);
  const withHash = {
    ...baseEntry,
    prevHash,
    entryHash,
  };

  const next = [withHash, ...current].slice(0, LEDGER_LIMIT);
  await chrome.storage.local.set({ ledger: next });
}

async function verifyLedger(entries) {
  let valid = true;
  let brokenAtIndex = -1;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const next = entries[i + 1];
    if (next && entry.prevHash !== next.entryHash) {
      valid = false;
      brokenAtIndex = i;
      break;
    }

    const clone = { ...entry };
    delete clone.entryHash;
    const recomputed = await sha256Hex(`${clone.prevHash}|${stableStringify(clone)}`);
    if (recomputed !== entry.entryHash) {
      valid = false;
      brokenAtIndex = i;
      break;
    }
  }

  return {
    valid,
    brokenAtIndex,
    checked: entries.length,
  };
}

async function hashFindingFingerprints(findings, limit) {
  const capped = Array.isArray(findings) ? findings.slice(0, limit) : [];
  const out = [];
  for (const finding of capped) {
    const raw = String(finding.match || "");
    const spanHash = await sha256Hex(raw);
    out.push({
      category: String(finding.category || "UNKNOWN"),
      spanHash,
    });
  }
  return out;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;

  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function buildAuditReport(entries, integrity) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const totals = safeEntries.length;
  const actionBreakdown = {};
  const domainCounts = {};
  const categoryCounts = {};
  let riskSum = 0;
  let injectionAlerts = 0;

  for (const entry of safeEntries) {
    const action = String(entry.action || "UNKNOWN");
    actionBreakdown[action] = (actionBreakdown[action] || 0) + 1;
    const domain = String(entry.domain || "unknown");
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    const risk = Number.isFinite(entry.risk) ? Number(entry.risk) : 0;
    riskSum += risk;

    const cats = Array.isArray(entry.categories) ? entry.categories : [];
    for (const c of cats) {
      const key = String(c);
      categoryCounts[key] = (categoryCounts[key] || 0) + 1;
    }

    const injectionScore = Number(entry.injection?.score || 0);
    if (injectionScore > 0) injectionAlerts += 1;
  }

  return {
    totals,
    avgRisk: totals ? Number((riskSum / totals).toFixed(1)) : 0,
    injectionAlerts,
    integrity: integrity || { valid: true, checked: totals, brokenAtIndex: -1 },
    actionBreakdown,
    topDomains: Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain, count]) => ({ domain, count })),
    topCategories: Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([category, count]) => ({ category, count })),
  };
}

function isLocalProxyUrl(raw) {
  try {
    const u = new URL(raw);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1" ||
      u.protocol === "chrome-extension:"
    );
  } catch {
    return false;
  }
}

async function runProxyChain({ text, policy, metadata }) {
  const hops = [];
  const chain = Array.isArray(policy.proxyChain) ? policy.proxyChain.filter((h) => h.enabled !== false) : [];

  if (!policy.proxyChainEnabled || chain.length === 0) {
    return {
      ok: true,
      text,
      hops,
      aborted: false,
      error: "",
    };
  }

  let current = String(text || "");
  for (const hop of chain) {
    const started = Date.now();
    const result = {
      id: hop.id,
      name: hop.name,
      url: hop.url,
      transform: hop.transform,
      failPolicy: hop.failPolicy,
      ok: false,
      status: 0,
      latencyMs: 0,
      error: "",
      skipped: false,
    };

    if (policy.localOnlyMode && !isLocalProxyUrl(hop.url)) {
      result.skipped = true;
      result.ok = false;
      result.error = "Skipped by local-only mode.";
      result.latencyMs = Date.now() - started;
      hops.push(result);
      if (hop.failPolicy === "abort") {
        return {
          ok: false,
          text: current,
          hops,
          aborted: true,
          error: result.error,
        };
      }
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), clampInt(hop.timeoutMs, 500, 15000, 3500));
      const headers = {
        "content-type": "application/json",
      };
      if (hop.authHeader && hop.authValue) {
        headers[hop.authHeader] = hop.authValue;
      }

      const response = await fetch(hop.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: current,
          metadata,
          hop: {
            id: hop.id,
            name: hop.name,
            transform: hop.transform,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      result.status = response.status;
      result.ok = response.ok;
      result.latencyMs = Date.now() - started;

      const raw = await response.text();
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }

      if (response.ok) {
        current = applyProxyTransform({
          current,
          transform: hop.transform,
          parsed,
          raw,
        });
      } else {
        result.error = `HTTP ${response.status}`;
      }

      hops.push(result);
      if (!response.ok && hop.failPolicy === "abort") {
        return {
          ok: false,
          text: current,
          hops,
          aborted: true,
          error: result.error || "Proxy hop failed.",
        };
      }
    } catch (err) {
      result.latencyMs = Date.now() - started;
      result.ok = false;
      result.error = err instanceof Error ? err.message : "Proxy request failed.";
      hops.push(result);
      if (hop.failPolicy === "abort") {
        return {
          ok: false,
          text: current,
          hops,
          aborted: true,
          error: result.error,
        };
      }
    }
  }

  return {
    ok: true,
    text: current,
    hops,
    aborted: false,
    error: "",
  };
}

function applyProxyTransform({ current, transform, parsed, raw }) {
  const candidate =
    (parsed && typeof parsed === "object" && (parsed.output || parsed.text || parsed.redactedText)) ||
    (typeof raw === "string" ? raw : "");
  const next = typeof candidate === "string" ? candidate : "";

  if (transform === "passthrough" || transform === "audit") return current;
  if (transform === "rewrite") return next.trim() ? next : current;
  if (transform === "filter") {
    const source = next.trim() ? next : current;
    return source
      .split("\n")
      .filter((line) => !/ignore (all|previous) instructions/i.test(line))
      .join("\n")
      .trim() || current;
  }
  return current;
}

async function appendVaultEntries(candidates, domain) {
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  const { vault } = await chrome.storage.local.get("vault");
  const current = Array.isArray(vault) ? vault : [];

  const nextEntries = [];
  for (const item of candidates) {
    const rawValue = String(item.raw || "");
    if (!rawValue) continue;
    const valueHash = await sha256Hex(rawValue);
    nextEntries.push({
      id: crypto.randomUUID(),
      ts: Date.now(),
      domain: String(domain || "unknown"),
      placeholder: String(item.placeholder || "[REDACTED]"),
      category: String(item.category || "UNKNOWN"),
      valueHash,
      masked: String(item.masked || maskValue(rawValue)),
      valueLength: rawValue.length,
    });
  }

  if (nextEntries.length === 0) return;
  const merged = [...nextEntries, ...current].slice(0, VAULT_LIMIT);
  await chrome.storage.local.set({ vault: merged });
}

function maskValue(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 4) return "*".repeat(raw.length);
  return `${raw.slice(0, 2)}${"*".repeat(Math.max(2, raw.length - 4))}${raw.slice(-2)}`;
}

/** ---------- Detection Engine ---------- */

const DETECTORS = [
  {
    category: "EMAIL",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    category: "PHONE",
    regex: /\b(?:\+?\d{1,2}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    category: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    category: "SECRET",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    category: "SECRET",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    category: "SECRET",
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    category: "SECRET",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    category: "SECRET",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,
  },
  {
    category: "SECRET",
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    category: "JWT",
    regex: /\beyJ[A-Za-z0-9\-_]+?\.[A-Za-z0-9\-_]+?\.[A-Za-z0-9\-_]+\b/g,
  },
  {
    category: "PRIVATE_KEY",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g,
  },
  {
    category: "ADDRESS",
    regex:
      /\b\d{1,5}\s+[A-Za-z0-9.\- ]+\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi,
  },
];

const GENERIC_TOKEN_REGEX = /\b[A-Za-z0-9+/_=-]{24,}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

const CATEGORY_WEIGHTS = {
  PRIVATE_KEY: 100,
  SECRET: 80,
  JWT: 80,
  SSN: 70,
  FINANCIAL: 70,
  ADDRESS: 20,
  PHONE: 15,
  EMAIL: 15,
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
    findings.push({
      category: "FINANCIAL",
      start,
      end: start + match[0].length,
      match: match[0],
    });
  }

  for (const match of text.matchAll(GENERIC_TOKEN_REGEX)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const token = match[0];
    if (!looksLikeSecret(token, text, start)) continue;
    findings.push({
      category: "SECRET",
      start,
      end: start + token.length,
      match: token,
    });
  }

  const deduped = dedupeFindings(findings);
  const counts = countFindings(deduped);
  const categories = Object.keys(counts).sort((a, b) => (CATEGORY_WEIGHTS[b] || 0) - (CATEGORY_WEIGHTS[a] || 0));
  const risk = scoreRisk(counts);

  return {
    risk,
    categories,
    counts,
    findings: deduped,
    originalLength: text.length,
  };
}

function addRegexFindings(bucket, category, regex, text) {
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    bucket.push({
      category,
      start,
      end: start + match[0].length,
      match: match[0],
    });
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
    if (overlapIndex === -1) {
      kept.push(finding);
      continue;
    }

    const existing = kept[overlapIndex];
    const existingWeight = CATEGORY_WEIGHTS[existing.category] || 0;
    const nextWeight = CATEGORY_WEIGHTS[finding.category] || 0;
    const existingLen = existing.end - existing.start;
    const nextLen = finding.end - finding.start;

    if (nextWeight > existingWeight || (nextWeight === existingWeight && nextLen > existingLen)) {
      kept[overlapIndex] = finding;
    }
  }

  return kept.sort((a, b) => a.start - b.start);
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function countFindings(findings) {
  const counts = {};
  for (const finding of findings) {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
  }
  return counts;
}

function scoreRisk(counts) {
  let score = 0;

  for (const [category, count] of Object.entries(counts)) {
    const weight = CATEGORY_WEIGHTS[category] || 10;
    const safeCount = Math.max(0, Number(count) || 0);
    if (safeCount === 0) continue;
    score += weight;
    if (safeCount > 1) {
      score += Math.min(weight * 0.6, (safeCount - 1) * (weight * 0.25));
    }
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
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const hasSymbol = /[^A-Za-z0-9]/.test(token);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  return classes >= 3;
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function luhnCheck(numStr) {
  let sum = 0;
  let alternate = false;
  for (let i = numStr.length - 1; i >= 0; i -= 1) {
    let n = numStr.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function applyRedactions(text, findings) {
  const safeFindings = dedupeFindings(Array.isArray(findings) ? findings : []);
  const redactions = [];
  const redactionCounts = {};
  const tokenMap = new Map();
  const serialByCategory = {};

  let cursor = 0;
  let out = "";

  for (const finding of safeFindings) {
    out += text.slice(cursor, finding.start);
    const key = `${finding.category}:${finding.match}`;
    if (!tokenMap.has(key)) {
      serialByCategory[finding.category] = (serialByCategory[finding.category] || 0) + 1;
      tokenMap.set(key, placeholderFor(finding.category, serialByCategory[finding.category]));
    }

    const replacement = tokenMap.get(key);
    out += replacement;
    redactions.push({
      category: finding.category,
      start: finding.start,
      end: finding.end,
      replacement,
    });
    redactionCounts[finding.category] = (redactionCounts[finding.category] || 0) + 1;
    cursor = finding.end;
  }

  out += text.slice(cursor);
  return {
    redactedText: out,
    redactions,
    redactionCounts,
  };
}

function placeholderFor(category, idx) {
  switch (category) {
    case "EMAIL":
      return `[EMAIL_${idx}]`;
    case "PHONE":
      return `[PHONE_${idx}]`;
    case "SSN":
      return `[SSN_${idx}]`;
    case "FINANCIAL":
      return `[CARD_${idx}]`;
    case "PRIVATE_KEY":
      return `[PRIVATE_KEY_REDACTED_${idx}]`;
    case "SECRET":
      return `[API_SECRET_${idx}]`;
    case "JWT":
      return `[JWT_${idx}]`;
    case "ADDRESS":
      return `[ADDRESS_${idx}]`;
    default:
      return `[REDACTED_${idx}]`;
  }
}

function buildSafeRewrite(redactedText, categories) {
  const categoryLine = categories.length > 0 ? categories.join(", ") : "none";
  return [
    "Rewrite this request safely for an AI assistant.",
    "Rules:",
    "- Keep placeholders exactly as-is.",
    "- Do not ask for or infer hidden secret values.",
    "- Provide a concise, practical answer that works with redacted data.",
    "",
    `Detected categories: ${categoryLine}`,
    "",
    "Sanitized request:",
    redactedText,
  ].join("\n");
}
