const PF_STATE = {
  lastFocusedEditable: null,
  bypassUntil: 0,
  inFlight: false,
};

const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
const CHAT_HOST_HINTS   = ["chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai", "perplexity.ai"];
const CHAT_INPUT_HINTS  = ["prompt", "message", "chat", "ask", "assistant"];

document.addEventListener("focusin", (e) => {
  const el = getEditableFromTarget(e.target);
  if (el) PF_STATE.lastFocusedEditable = el;
}, true);

document.addEventListener("keydown", (e) => {
  if (!shouldHandle(e)) return;
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.isComposing) return;
  const el = getEditableFromTarget(e.target);
  if (!el || !isLikelyChatInput(el)) return;
  const text = getText(el);
  if (!text.trim()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  void handleSend({ editable: el, originalText: text, triggerMeta: { type: "enter" } });
}, true);

document.addEventListener("click", (e) => {
  if (!shouldHandle(e)) return;
  const btn = getSendButton(e.target);
  if (!btn) return;
  const el = locateBestEditable(btn);
  if (!el || !isLikelyChatInput(el)) return;
  const text = getText(el);
  if (!text.trim()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  void handleSend({ editable: el, originalText: text, triggerMeta: { type: "button", button: btn } });
}, true);

document.addEventListener("submit", (e) => {
  if (!shouldHandle(e)) return;
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const el = form.querySelector(EDITABLE_SELECTOR) || locateBestEditable(form);
  if (!el || !isLikelyChatInput(el)) return;
  const text = getText(el);
  if (!text.trim()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  void handleSend({ editable: el, originalText: text, triggerMeta: { type: "form", form } });
}, true);

document.addEventListener("paste", (e) => {
  if (!shouldHandle(e)) return;
  const el = getEditableFromTarget(e.target);
  if (!el || !isLikelyChatInput(el) || !e.clipboardData) return;
  const pasted = e.clipboardData.getData("text/plain");
  if (!pasted) return;
  void handlePaste(e, el, pasted);
}, true);

function shouldHandle(e) {
  return e.isTrusted && !PF_STATE.inFlight && Date.now() >= PF_STATE.bypassUntil;
}

// ─────────────────────────────────────────────
//  Core send handler
// ─────────────────────────────────────────────
async function handleSend({ editable, originalText, triggerMeta }) {
  PF_STATE.inFlight = true;
  try {
    const resp = await sendMsg({ type: "CLASSIFY_AND_REDACT", payload: { text: originalText, url: location.href, trigger: triggerMeta.type } });

    if (!resp?.ok) {
      toast("⚠ Prompt Firewall: scan failed, sending original.");
      await executeSend(editable, originalText, triggerMeta);
      return;
    }

    const { analysis, decision, redactedText, redactions, policy, injectionResult } = resp;

    // ── Proxy chain ─────────────────────────────────────────────────────
    let textToSend = originalText;
    let proxyHops  = null;

    if (policy?.proxyChainEnabled && Array.isArray(policy.proxyChain) && policy.proxyChain.length > 0) {
      const proxyInput = decision.action !== "ALLOW" ? redactedText : originalText;
      const proxyResp  = await sendMsg({
        type: "PROXY_CHAIN_EXECUTE",
        payload: { text: proxyInput, domain: location.hostname },
      });
      if (proxyResp?.ok && !proxyResp.skipped) {
        textToSend = proxyResp.finalText;
        proxyHops  = proxyResp.hops;
        const failedHops = proxyResp.hops.filter((h) => !h.skipped && !h.success);
        if (failedHops.length > 0) toast(`⚠ ${failedHops.length} proxy hop(s) failed — using fallback text.`);
        if (proxyResp.aborted) {
          toast("🛑 Proxy chain aborted — send cancelled.");
          return;
        }
      }
    }

    // ── Show injection warning banner if detected ───────────────────────
    if (injectionResult?.detected) {
      showInjectionBanner(injectionResult);
    }

    // ── Dispatch by decision ────────────────────────────────────────────
    if (decision.action === "ALLOW") {
      const finalText = proxyHops ? textToSend : originalText;
      await executeSend(editable, finalText, triggerMeta);
      if (proxyHops) showProxyToast(proxyHops);
      return;
    }

    if (decision.action === "AUTO_REDACT") {
      const finalText = proxyHops ? textToSend : redactedText;
      toast(`🔒 Sensitive data redacted (risk ${analysis.risk}/100).`);
      await executeSend(editable, finalText, triggerMeta);
      await storeVaultEntries(redactions);
      await appendResolution({ action: "AUTO_REDACT_SENT", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "Auto-redacted and sent." });
      if (proxyHops) showProxyToast(proxyHops);
      return;
    }

    // BLOCK ── show modal
    const choice = await showBlockModal({
      analysis, redactedText, redactions, canOverride: decision.canOverride,
      holdMs: policy?.holdToConfirmMs || 2000, injectionResult, proxyHops,
    });

    if (choice === "SEND_REDACTED") {
      const finalText = proxyHops ? textToSend : redactedText;
      await executeSend(editable, finalText, triggerMeta);
      await storeVaultEntries(redactions);
      await appendResolution({ action: "SEND_REDACTED", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "User chose redacted send." });
      if (proxyHops) showProxyToast(proxyHops);
      return;
    }

    if (choice === "SEND_REWRITE") {
      const rewrite = await sendMsg({ type: "SAFE_REWRITE", payload: { redactedText, categories: analysis.categories || [] } });
      const output  = rewrite?.ok && rewrite.rewrittenText ? rewrite.rewrittenText : redactedText;
      const finalText = proxyHops ? textToSend : output;
      await executeSend(editable, finalText, triggerMeta);
      await storeVaultEntries(redactions);
      await appendResolution({ action: "SEND_REWRITE", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "User chose redacted + safe rewrite." });
      return;
    }

    if (choice === "OVERRIDE_ORIGINAL") {
      if (!decision.canOverride) {
        toast("🚫 Override denied by policy for secret-class data.");
        await appendResolution({ action: "OVERRIDE_DENIED", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "Policy denied secret override." });
        return;
      }
      await executeSend(editable, originalText, triggerMeta);
      await appendResolution({ action: "OVERRIDE_ORIGINAL", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "User completed step-up and sent original." });
      return;
    }

    toast("✋ Send canceled.");
    await appendResolution({ action: "CANCELLED", risk: analysis.risk, categories: analysis.categories, counts: analysis.counts, note: "User canceled blocked send." });
  } catch {
    toast("⚠ Prompt Firewall: fallback send.");
    await executeSend(editable, originalText, triggerMeta);
  } finally {
    PF_STATE.inFlight = false;
  }
}

async function handlePaste(event, editable, pastedText) {
  const resp = await sendMsg({ type: "CLASSIFY_AND_REDACT", payload: { text: pastedText, url: location.href, trigger: "paste" } });
  if (!resp?.ok || !resp.policy?.clipboardProtection || resp.decision.action === "ALLOW") return;
  event.preventDefault();
  insertAtCursor(editable, resp.redactedText || pastedText);
  toast(`📋 Paste sanitized (${resp.analysis?.risk || 0}/100).`);
  await storeVaultEntries(resp.redactions || []);
  await appendResolution({ action: "PASTE_REDACTED", risk: resp.analysis?.risk || 0, categories: resp.analysis?.categories || [], counts: resp.analysis?.counts || {}, note: "Clipboard protection sanitized paste." });
}

// ─────────────────────────────────────────────
//  Data Vault helper
// ─────────────────────────────────────────────
async function storeVaultEntries(redactions) {
  if (!Array.isArray(redactions) || redactions.length === 0) return;
  const entries = redactions.map((r) => ({ placeholder: r.replacement, category: r.category }));
  await sendMsg({ type: "VAULT_STORE", payload: { entries } });
}

// ─────────────────────────────────────────────
//  Injection warning banner
// ─────────────────────────────────────────────
function showInjectionBanner(injectionResult) {
  const existing = document.getElementById("pf-injection-banner");
  if (existing) existing.remove();

  const signals = (injectionResult.signals || []).map((s) => s.signal.replace(/_/g, " ")).join(", ");
  const banner  = document.createElement("div");
  banner.id     = "pf-injection-banner";
  banner.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
    "background:#7c2d12", "color:#fff", "padding:10px 16px",
    "font:13px/1.4 system-ui,sans-serif", "display:flex", "align-items:center",
    "justify-content:space-between", "gap:12px",
    "box-shadow:0 2px 12px rgba(0,0,0,0.4)",
  ].join(";");
  banner.innerHTML = `
    <span>🚨 <b>Prompt Injection Detected</b> — Signals: ${escHtml(signals)} (score: ${injectionResult.score}/100)</span>
    <button id="pf-banner-close" style="border:0;background:rgba(255,255,255,0.2);color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:600;">Dismiss</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector("#pf-banner-close").addEventListener("click", () => banner.remove());
  setTimeout(() => banner.remove(), 8000);
}

function showProxyToast(hops) {
  const ok   = hops.filter((h) => h.success).length;
  const fail = hops.filter((h) => !h.skipped && !h.success).length;
  toast(`🔗 Proxy chain: ${ok} hop(s) OK${fail ? `, ${fail} failed (passthrough)` : ""}.`);
}

// ─────────────────────────────────────────────
//  Block modal (extended)
// ─────────────────────────────────────────────
function showBlockModal({ analysis, redactedText, redactions, canOverride, holdMs, injectionResult, proxyHops }) {
  return new Promise((resolve) => {
    let timer = null; let start = 0;

    const overlay = mk("div", [
      "position:fixed","inset:0","z-index:2147483647","background:rgba(15,23,42,0.65)",
      "display:flex","align-items:center","justify-content:center","padding:20px",
    ]);

    const card = mk("div", [
      "width:min(740px,96vw)","max-height:92vh","overflow:auto","background:#ffffff",
      "color:#111827","border-radius:16px","padding:18px","box-shadow:0 20px 48px rgba(15,23,42,0.35)",
      "font:13px/1.45 system-ui,sans-serif",
    ]);

    const categoryText      = (analysis.categories || []).join(", ") || "Unknown";
    const redactionSummary  = summarizeRedactions(redactions || []);
    const injectionHtml     = injectionResult?.detected
      ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:8px 10px;margin-bottom:10px;">
           <b style="color:#991b1b;">🚨 Prompt Injection:</b>
           <span style="color:#7f1d1d;">${escHtml((injectionResult.signals || []).map(s => s.signal.replace(/_/g," ")).join(", "))} (score ${injectionResult.score}/100)</span>
         </div>` : "";
    const proxyHtml = proxyHops && proxyHops.length > 0
      ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:8px 10px;margin-bottom:10px;font-size:11px;">
           <b style="color:#166534;">🔗 Proxy chain:</b> ${proxyHops.map((h) =>
             `<span style="margin-right:6px;padding:1px 6px;border-radius:4px;background:${h.success?"#bbf7d0":"#fecaca"};color:${h.success?"#14532d":"#7f1d1d"};">
               ${escHtml(h.label||`Hop ${h.index+1}`)} ${h.latencyMs ? `(${h.latencyMs}ms)` : ""} ${h.success?"✓":"✗ "+escHtml(h.error||"")}
             </span>`).join("")}
         </div>` : "";

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;">
        <div style="font-weight:700;font-size:15px;">🔥 Prompt Firewall blocked this send</div>
        <div style="font-size:12px;background:#111827;color:#fff;padding:4px 8px;border-radius:999px;">Risk ${escHtml(String(analysis.risk||0))}/100</div>
      </div>
      <div style="font-size:12px;color:#4b5563;margin-bottom:10px;">Detected: <b>${escHtml(categoryText)}</b></div>
      ${injectionHtml}
      ${proxyHtml}
      <div style="display:grid;gap:10px;margin-bottom:10px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Redaction summary</div>
          <div style="font-size:12px;color:#334155">${escHtml(redactionSummary || "No redactions.")}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Redacted preview</div>
          <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.35 ui-monospace,monospace;color:#0f172a;max-height:200px;overflow:auto;">${escHtml(redactedText||"")}</pre>
        </div>
      </div>
      <div id="pf-override-zone" style="display:none;margin-bottom:10px;border:1px solid #f59e0b;background:#fffbeb;border-radius:12px;padding:10px;">
        <div style="font-weight:600;font-size:12px;color:#92400e;margin-bottom:6px;">Step-up required</div>
        <div style="font-size:12px;color:#78350f;margin-bottom:8px;">Hold confirm for ${Math.round(holdMs/100)/10}s to send original.</div>
        <div style="height:8px;border-radius:999px;background:#fde68a;overflow:hidden;margin-bottom:8px;">
          <div id="pf-hold-progress" style="width:0%;height:100%;background:#f59e0b;transition:width 0.05s linear;"></div>
        </div>
        <button id="pf-hold-btn" style="padding:8px 10px;border:0;border-radius:10px;background:#92400e;color:#fff;font-weight:600;cursor:pointer;">Hold to confirm override</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
        <button id="pf-cancel" style="padding:8px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;cursor:pointer;">Cancel</button>
        <button id="pf-send-redacted" style="padding:8px 10px;border:0;background:#111827;color:#fff;border-radius:10px;cursor:pointer;">Send redacted</button>
        <button id="pf-send-rewrite" style="padding:8px 10px;border:0;background:#1d4ed8;color:#fff;border-radius:10px;cursor:pointer;">Send + safe rewrite</button>
        ${canOverride
          ? '<button id="pf-request-override" style="padding:8px 10px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:10px;cursor:pointer;">Request override</button>'
          : '<button disabled style="padding:8px 10px;border:1px solid #e2e8f0;background:#f8fafc;color:#94a3b8;border-radius:10px;">Override disabled</button>'}
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = () => { if (timer) { clearInterval(timer); timer = null; } window.removeEventListener("keydown", onEsc, true); overlay.remove(); };
    const done    = (choice) => { cleanup(); resolve(choice); };
    const onEsc   = (e) => { if (e.key === "Escape") { e.preventDefault(); done("CANCEL"); } };

    window.addEventListener("keydown", onEsc, true);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done("CANCEL"); });
    card.querySelector("#pf-cancel")?.addEventListener("click", () => done("CANCEL"));
    card.querySelector("#pf-send-redacted")?.addEventListener("click", () => done("SEND_REDACTED"));
    card.querySelector("#pf-send-rewrite")?.addEventListener("click", () => done("SEND_REWRITE"));

    const overrideBtn = card.querySelector("#pf-request-override");
    const zone        = card.querySelector("#pf-override-zone");
    const holdBtn     = card.querySelector("#pf-hold-btn");
    const progress    = card.querySelector("#pf-hold-progress");

    const resetHold = () => { if (timer) { clearInterval(timer); timer = null; } start = 0; if (progress) progress.style.width = "0%"; };
    const startHold = () => {
      if (!holdBtn || !progress) return;
      resetHold(); start = Date.now();
      timer = setInterval(() => {
        const pct = Math.min(1, (Date.now() - start) / holdMs);
        progress.style.width = `${Math.round(pct * 100)}%`;
        if (pct >= 1) { resetHold(); done("OVERRIDE_ORIGINAL"); }
      }, 24);
    };

    if (overrideBtn && zone) overrideBtn.addEventListener("click", () => { zone.style.display = "block"; });
    if (holdBtn) {
      holdBtn.addEventListener("mousedown", startHold);
      holdBtn.addEventListener("touchstart", startHold, { passive: true });
      holdBtn.addEventListener("mouseup", resetHold);
      holdBtn.addEventListener("mouseleave", resetHold);
      holdBtn.addEventListener("touchend", resetHold);
      holdBtn.addEventListener("touchcancel", resetHold);
    }
  });
}

// ─────────────────────────────────────────────
//  DOM helpers
// ─────────────────────────────────────────────
function mk(tag, styles) {
  const el = document.createElement(tag);
  el.style.cssText = Array.isArray(styles) ? styles.join(";") : styles;
  return el;
}

function getEditableFromTarget(target) {
  if (!(target instanceof Element)) return null;
  if (isEditable(target)) return target;
  return target.closest(EDITABLE_SELECTOR);
}

function isEditable(el) {
  if (!(el instanceof Element)) return false;
  if (el.matches("textarea")) return !el.hasAttribute("disabled") && !el.hasAttribute("readonly");
  return el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "plaintext-only";
}

function isLikelyChatInput(el) {
  if (!isEditable(el)) return false;
  const host = location.hostname.toLowerCase();
  if (CHAT_HOST_HINTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  const attrs = [el.id, el.getAttribute("name"), el.getAttribute("aria-label"), el.getAttribute("placeholder")].filter(Boolean).join(" ").toLowerCase();
  if (CHAT_INPUT_HINTS.some((h) => attrs.includes(h))) return true;
  const nearby = (el.closest("form, section, main, div")?.textContent || "").slice(0, 500).toLowerCase();
  return CHAT_INPUT_HINTS.some((h) => nearby.includes(h));
}

function getText(el) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || "";
  return (el.innerText || "").replace(/\u00a0/g, " ");
}

function setText(el, text) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = text; el.dispatchEvent(new Event("input", { bubbles: true })); return;
  }
  el.textContent = text; el.dispatchEvent(new Event("input", { bubbles: true }));
}

function getSendButton(target) {
  if (!(target instanceof Element)) return null;
  const btn = target.closest('button, [role="button"], input[type="submit"]');
  if (!btn || !looksLikeSend(btn)) return null;
  return btn;
}

function looksLikeSend(btn) {
  if (btn.matches('[data-testid="send-button"]')) return true;
  const text = [btn.getAttribute("aria-label"), btn.getAttribute("title"), btn.textContent, btn.getAttribute("data-testid"), btn.getAttribute("name")].filter(Boolean).join(" ").toLowerCase();
  return /(send|submit|run|ask|arrow up|paper airplane|upward)/.test(text);
}

function locateBestEditable(anchor) {
  if (PF_STATE.lastFocusedEditable && document.contains(PF_STATE.lastFocusedEditable)) return PF_STATE.lastFocusedEditable;
  if (anchor instanceof Element) {
    const form = anchor.closest("form");
    if (form) { const el = form.querySelector(EDITABLE_SELECTOR); if (el) return el; }
    const container = anchor.closest("section, main, article, div");
    if (container) { const el = container.querySelector(EDITABLE_SELECTOR); if (el) return el; }
  }
  return document.querySelector(EDITABLE_SELECTOR);
}

function insertAtCursor(el, text) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true })); return;
  }
  el.focus();
  if (!document.execCommand("insertText", false, text)) setText(el, getText(el) + text);
}

async function executeSend(editable, text, triggerMeta) {
  setText(editable, text);
  await new Promise((r) => setTimeout(r, 16));
  PF_STATE.bypassUntil = Date.now() + 700;

  if (triggerMeta.type === "button" && triggerMeta.button?.isConnected) { triggerMeta.button.click(); return; }
  if (triggerMeta.type === "form"   && triggerMeta.form?.isConnected)   { triggerMeta.form.requestSubmit(); return; }
  if (clickKnownSend()) return;

  for (const type of ["keydown", "keyup"]) {
    editable.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  }
  const form = editable.closest("form");
  if (form) form.requestSubmit();
}

function clickKnownSend() {
  const selectors = [
    'button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Submit" i]',
    'button[title*="Send" i]', 'button[aria-label*="Run" i]', 'button[type="submit"]',
  ];
  for (const sel of selectors) {
    const candidates = Array.from(document.querySelectorAll(sel));
    const target = candidates.find((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if ((el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && s.pointerEvents !== "none";
    });
    if (target) { target.click(); return true; }
  }
  return false;
}

// ─────────────────────────────────────────────
//  Messaging / utils
// ─────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
      resolve(resp || { ok: false, error: "No response." });
    });
  });
}

async function appendResolution(payload) {
  await sendMsg({ type: "LEDGER_APPEND", payload: { ...payload, domain: location.hostname, trigger: "content_resolution", eventType: "user_resolution" } });
}

function toast(message, durationMs = 2800) {
  const node = document.createElement("div");
  node.textContent = message;
  node.style.cssText = [
    "position:fixed","right:16px","bottom:16px","z-index:2147483647",
    "padding:10px 14px","border-radius:10px","font:12px/1.3 system-ui,sans-serif",
    "background:#111827","color:#f9fafb","box-shadow:0 8px 20px rgba(0,0,0,0.3)","opacity:0.98",
    "max-width:380px","word-wrap:break-word",
  ].join(";");
  document.body.appendChild(node);
  setTimeout(() => node.remove(), durationMs);
}

function summarizeRedactions(redactions) {
  if (!Array.isArray(redactions) || redactions.length === 0) return "";
  const counts = {};
  for (const r of redactions) counts[r.category] = (counts[r.category] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" • ");
}

function escHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
