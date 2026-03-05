const els = {
  policyPack: document.getElementById("policy-pack"),
  enabled: document.getElementById("enabled"),
  autoThreshold: document.getElementById("auto-threshold"),
  blockThreshold: document.getElementById("block-threshold"),
  holdMs: document.getElementById("hold-ms"),
  allowlist: document.getElementById("allowlist"),
  strictDomains: document.getElementById("strict-domains"),
  denyOverrides: document.getElementById("deny-overrides"),
  clipboardProtection: document.getElementById("clipboard-protection"),
  localOnlyMode: document.getElementById("local-only-mode"),
  saveBtn: document.getElementById("save-btn"),
  resetPackBtn: document.getElementById("reset-pack-btn"),
  clearLedgerBtn: document.getElementById("clear-ledger-btn"),
  status: document.getElementById("status"),
};

const state = {
  policy: null,
  packs: {},
};

init().catch(() => {
  setStatus("Failed to load options.", true);
});

els.policyPack.addEventListener("change", () => {
  if (els.policyPack.value === "custom") return;
  applyPackToForm(els.policyPack.value);
});

els.saveBtn.addEventListener("click", async () => {
  const nextPolicy = collectPolicyFromForm();
  const resp = await sendMessage({
    type: "POLICY_SET",
    payload: { policy: nextPolicy },
  });
  if (!resp?.ok) {
    setStatus("Policy save failed.", true);
    return;
  }
  state.policy = resp.policy;
  renderPolicy(resp.policy);
  setStatus("Policy saved.");
});

els.resetPackBtn.addEventListener("click", () => {
  const pack = els.policyPack.value;
  if (pack === "custom") {
    setStatus("Select a named policy pack first.", true);
    return;
  }
  applyPackToForm(pack);
  setStatus(`Applied ${pack} defaults to form. Click Save Policy to persist.`);
});

els.clearLedgerBtn.addEventListener("click", async () => {
  const ok = confirm("Clear all ledger entries?");
  if (!ok) return;
  const resp = await sendMessage({ type: "LEDGER_CLEAR" });
  if (resp?.ok) setStatus("Ledger cleared.");
  else setStatus("Could not clear ledger.", true);
});

async function init() {
  const [policyResp, packsResp] = await Promise.all([
    sendMessage({ type: "POLICY_GET" }),
    sendMessage({ type: "POLICY_PACKS_GET" }),
  ]);

  if (!policyResp?.ok) throw new Error("policy_load_failed");
  state.policy = policyResp.policy;
  state.packs = packsResp?.ok && packsResp.packs ? packsResp.packs : {};
  renderPolicy(state.policy);
}

function renderPolicy(policy) {
  els.policyPack.value = policy.policyPack || "custom";
  if (!["student", "healthcare", "legal", "corporate", "custom"].includes(els.policyPack.value)) {
    els.policyPack.value = "custom";
  }

  els.enabled.checked = Boolean(policy.enabled);
  els.autoThreshold.value = String(policy.riskAutoRedactThreshold ?? 30);
  els.blockThreshold.value = String(policy.riskBlockThreshold ?? 70);
  els.holdMs.value = String(policy.holdToConfirmMs ?? 2000);
  els.allowlist.value = (policy.allowlistDomains || []).join(", ");
  els.strictDomains.value = (policy.strictModeDomains || []).join(", ");
  els.denyOverrides.checked = Boolean(policy.denyOverridesForSecrets);
  els.clipboardProtection.checked = Boolean(policy.clipboardProtection);
  els.localOnlyMode.checked = Boolean(policy.localOnlyMode);
}

function collectPolicyFromForm() {
  const pack = String(els.policyPack.value || "custom");
  return {
    enabled: els.enabled.checked,
    policyPack: pack,
    riskAutoRedactThreshold: clamp(Number(els.autoThreshold.value), 1, 100, 30),
    riskBlockThreshold: clamp(Number(els.blockThreshold.value), 1, 100, 70),
    holdToConfirmMs: clamp(Number(els.holdMs.value), 800, 7000, 2000),
    allowlistDomains: parseDomains(els.allowlist.value),
    strictModeDomains: parseDomains(els.strictDomains.value),
    denyOverridesForSecrets: els.denyOverrides.checked,
    clipboardProtection: els.clipboardProtection.checked,
    localOnlyMode: els.localOnlyMode.checked,
  };
}

function applyPackToForm(packName) {
  const pack = state.packs[packName];
  if (!pack) return;
  els.autoThreshold.value = String(pack.riskAutoRedactThreshold ?? els.autoThreshold.value);
  els.blockThreshold.value = String(pack.riskBlockThreshold ?? els.blockThreshold.value);
  els.denyOverrides.checked = Boolean(pack.denyOverridesForSecrets);
  els.clipboardProtection.checked = Boolean(pack.clipboardProtection);
  els.localOnlyMode.checked = Boolean(pack.localOnlyMode);
}

function parseDomains(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[\n,]/g)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
        .map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0])
    )
  );
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.className = `status-text ${isError ? "error" : "ok"}`;
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: "No response." });
    });
  });
}
