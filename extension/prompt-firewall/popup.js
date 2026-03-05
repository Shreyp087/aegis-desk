const state = {
  policy: null,
};

const els = {
  enabledToggle: document.getElementById("enabled-toggle"),
  policyPack: document.getElementById("policy-pack"),
  autoThreshold: document.getElementById("auto-threshold"),
  blockThreshold: document.getElementById("block-threshold"),
  ledgerIntegrity: document.getElementById("ledger-integrity"),
  events: document.getElementById("events"),
  refreshBtn: document.getElementById("refresh-btn"),
  openOptions: document.getElementById("open-options"),
  clearLedger: document.getElementById("clear-ledger"),
};

init().catch(() => {
  renderError("Unable to load extension status.");
});

els.enabledToggle.addEventListener("change", async () => {
  if (!state.policy) return;
  state.policy.enabled = Boolean(els.enabledToggle.checked);
  await setPolicy(state.policy);
  await refresh();
});

els.refreshBtn.addEventListener("click", async () => {
  await refresh();
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

els.clearLedger.addEventListener("click", async () => {
  const confirmed = confirm("Clear all trust ledger entries?");
  if (!confirmed) return;
  await sendMessage({ type: "LEDGER_CLEAR" });
  await refresh();
});

async function init() {
  await refresh();
}

async function refresh() {
  const [policyResp, ledgerResp, verifyResp] = await Promise.all([
    sendMessage({ type: "POLICY_GET" }),
    sendMessage({ type: "LEDGER_GET", payload: { limit: 5 } }),
    sendMessage({ type: "LEDGER_VERIFY" }),
  ]);

  if (!policyResp?.ok) throw new Error("policy_load_failed");
  state.policy = policyResp.policy;
  renderPolicy(state.policy);

  renderEvents(ledgerResp?.ok ? ledgerResp.ledger : []);
  renderIntegrity(verifyResp?.ok ? verifyResp : null);
}

function renderPolicy(policy) {
  els.enabledToggle.checked = Boolean(policy.enabled);
  els.policyPack.textContent = String(policy.policyPack || "custom").toUpperCase();
  els.autoThreshold.textContent = `${policy.riskAutoRedactThreshold}/100`;
  els.blockThreshold.textContent = `${policy.riskBlockThreshold}/100`;
}

function renderIntegrity(verifyResp) {
  if (!verifyResp) {
    els.ledgerIntegrity.textContent = "Unknown";
    els.ledgerIntegrity.className = "risk-medium";
    return;
  }

  if (verifyResp.valid) {
    els.ledgerIntegrity.textContent = `OK (${verifyResp.checked})`;
    els.ledgerIntegrity.className = "risk-low";
    return;
  }

  els.ledgerIntegrity.textContent = `Broken at #${verifyResp.brokenAtIndex}`;
  els.ledgerIntegrity.className = "risk-high";
}

function renderEvents(events) {
  els.events.innerHTML = "";
  if (!Array.isArray(events) || events.length === 0) {
    const item = document.createElement("li");
    item.className = "event-item muted";
    item.textContent = "No ledger events yet.";
    els.events.appendChild(item);
    return;
  }

  for (const event of events) {
    const item = document.createElement("li");
    item.className = "event-item";
    const risk = Number.isFinite(event.risk) ? event.risk : 0;
    item.innerHTML = `
      <div class="event-top">
        <span class="event-action">${escapeHtml(event.action || "INFO")}</span>
        <span class="${riskClass(risk)}">${risk}</span>
      </div>
      <div class="event-domain">${escapeHtml(event.domain || "unknown")}</div>
      <div class="event-meta">${formatTs(event.ts)} • ${escapeHtml(event.eventType || "event")}</div>
    `;
    els.events.appendChild(item);
  }
}

function riskClass(risk) {
  if (risk >= 70) return "pill risk-high";
  if (risk >= 30) return "pill risk-medium";
  return "pill risk-low";
}

function formatTs(ts) {
  if (!Number.isFinite(ts)) return "-";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "-";
  }
}

async function setPolicy(policy) {
  const resp = await sendMessage({
    type: "POLICY_SET",
    payload: { policy },
  });
  if (!resp?.ok) throw new Error("policy_save_failed");
  return resp.policy;
}

function renderError(message) {
  els.events.innerHTML = "";
  const item = document.createElement("li");
  item.className = "event-item muted";
  item.textContent = message;
  els.events.appendChild(item);
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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
