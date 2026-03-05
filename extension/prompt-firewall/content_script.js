const PF_STATE = {
  lastFocusedEditable: null,
  bypassUntil: 0,
  inFlight: false,
};

const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
const CHAT_HOST_HINTS = ["chatgpt.com", "chat.openai.com", "gemini.google.com", "claude.ai", "perplexity.ai"];
const CHAT_INPUT_HINTS = ["prompt", "message", "chat", "ask", "assistant"];

document.addEventListener(
  "focusin",
  (event) => {
    const editable = getEditableFromTarget(event.target);
    if (editable) PF_STATE.lastFocusedEditable = editable;
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (!shouldHandleTrustedEvent(event)) return;
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.isComposing) return;

    const editable = getEditableFromTarget(event.target);
    if (!editable || !isLikelyChatInput(editable)) return;
    const text = getEditableText(editable);
    if (!text.trim()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void handleSendAttempt({
      editable,
      originalText: text,
      triggerMeta: { type: "enter" },
    });
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    if (!shouldHandleTrustedEvent(event)) return;
    const button = getSendButtonFromTarget(event.target);
    if (!button) return;

    const editable = locateBestEditable(button);
    if (!editable || !isLikelyChatInput(editable)) return;

    const text = getEditableText(editable);
    if (!text.trim()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void handleSendAttempt({
      editable,
      originalText: text,
      triggerMeta: { type: "button", button },
    });
  },
  true
);

document.addEventListener(
  "submit",
  (event) => {
    if (!shouldHandleTrustedEvent(event)) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const editable = form.querySelector(EDITABLE_SELECTOR) || locateBestEditable(form);
    if (!editable || !isLikelyChatInput(editable)) return;
    const text = getEditableText(editable);
    if (!text.trim()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void handleSendAttempt({
      editable,
      originalText: text,
      triggerMeta: { type: "form", form },
    });
  },
  true
);

document.addEventListener(
  "paste",
  (event) => {
    if (!shouldHandleTrustedEvent(event)) return;
    const editable = getEditableFromTarget(event.target);
    if (!editable || !isLikelyChatInput(editable)) return;
    if (!event.clipboardData) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (!pasted) return;
    void handlePasteAttempt(event, editable, pasted);
  },
  true
);

function shouldHandleTrustedEvent(event) {
  if (!event.isTrusted) return false;
  if (PF_STATE.inFlight) return false;
  if (Date.now() < PF_STATE.bypassUntil) return false;
  return true;
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

  const attrs = [el.id, el.getAttribute("name"), el.getAttribute("aria-label"), el.getAttribute("placeholder")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (CHAT_INPUT_HINTS.some((hint) => attrs.includes(hint))) return true;

  const nearby = (el.closest("form, section, main, div")?.textContent || "").slice(0, 500).toLowerCase();
  return CHAT_INPUT_HINTS.some((hint) => nearby.includes(hint));
}

function getEditableText(el) {
  if (el instanceof HTMLTextAreaElement) return el.value || "";
  if (el instanceof HTMLInputElement) return el.value || "";
  return (el.innerText || "").replace(/\u00a0/g, " ");
}

function setEditableText(el, text) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function getSendButtonFromTarget(target) {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button, [role="button"], input[type="submit"]');
  if (!button) return null;
  if (!looksLikeSendButton(button)) return null;
  return button;
}

function looksLikeSendButton(button) {
  const text = [
    button.getAttribute("aria-label"),
    button.getAttribute("title"),
    button.textContent,
    button.getAttribute("data-testid"),
    button.getAttribute("name"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (button.matches('[data-testid="send-button"]')) return true;
  return /(send|submit|run|ask|arrow up|paper airplane|upward)/.test(text);
}

function locateBestEditable(anchor) {
  if (PF_STATE.lastFocusedEditable && document.contains(PF_STATE.lastFocusedEditable)) {
    return PF_STATE.lastFocusedEditable;
  }

  if (anchor instanceof Element) {
    const withinForm = anchor.closest("form");
    if (withinForm) {
      const editable = withinForm.querySelector(EDITABLE_SELECTOR);
      if (editable) return editable;
    }

    const container = anchor.closest("section, main, article, div");
    if (container) {
      const editable = container.querySelector(EDITABLE_SELECTOR);
      if (editable) return editable;
    }
  }

  return document.querySelector(EDITABLE_SELECTOR);
}

async function handleSendAttempt({ editable, originalText, triggerMeta }) {
  PF_STATE.inFlight = true;
  try {
    const resp = await classifyAndRedact(originalText, triggerMeta.type);

    if (!resp?.ok) {
      toast("Prompt Firewall warning: scan failed, sending original.");
      await executeSend(editable, originalText, triggerMeta);
      return;
    }

    const { analysis, decision, redactedText, redactions, policy } = resp;

    if (decision.action === "ALLOW") {
      await executeSend(editable, originalText, triggerMeta);
      return;
    }

    if (decision.action === "AUTO_REDACT") {
      toast(`Sensitive data redacted (risk ${analysis.risk}/100).`);
      await executeSend(editable, redactedText, triggerMeta);
      await appendResolution({
        action: "AUTO_REDACT_SENT",
        risk: analysis.risk,
        categories: analysis.categories,
        counts: analysis.counts,
        note: "Auto-redacted and sent.",
      });
      return;
    }

    const choice = await showBlockModal({
      analysis,
      redactedText,
      redactions,
      canOverride: decision.canOverride,
      holdMs: policy?.holdToConfirmMs || 2000,
    });

    if (choice === "SEND_REDACTED") {
      await executeSend(editable, redactedText, triggerMeta);
      await appendResolution({
        action: "SEND_REDACTED",
        risk: analysis.risk,
        categories: analysis.categories,
        counts: analysis.counts,
        note: "User chose redacted send.",
      });
      return;
    }

    if (choice === "SEND_REWRITE") {
      const rewrite = await sendMessage({
        type: "SAFE_REWRITE",
        payload: {
          redactedText,
          categories: analysis.categories || [],
        },
      });
      const output = rewrite?.ok && rewrite.rewrittenText ? rewrite.rewrittenText : redactedText;
      await executeSend(editable, output, triggerMeta);
      await appendResolution({
        action: "SEND_REWRITE",
        risk: analysis.risk,
        categories: analysis.categories,
        counts: analysis.counts,
        note: "User chose redacted + safe rewrite send.",
      });
      return;
    }

    if (choice === "OVERRIDE_ORIGINAL") {
      if (!decision.canOverride) {
        toast("Override denied by policy for secret-class data.");
        await appendResolution({
          action: "OVERRIDE_DENIED",
          risk: analysis.risk,
          categories: analysis.categories,
          counts: analysis.counts,
          note: "Policy denied secret override.",
        });
        return;
      }
      await executeSend(editable, originalText, triggerMeta);
      await appendResolution({
        action: "OVERRIDE_ORIGINAL",
        risk: analysis.risk,
        categories: analysis.categories,
        counts: analysis.counts,
        note: "User completed step-up and sent original.",
      });
      return;
    }

    toast("Send canceled.");
    await appendResolution({
      action: "CANCELLED",
      risk: analysis.risk,
      categories: analysis.categories,
      counts: analysis.counts,
      note: "User canceled blocked send.",
    });
  } catch {
    toast("Prompt Firewall warning: fallback send.");
    await executeSend(editable, originalText, triggerMeta);
  } finally {
    PF_STATE.inFlight = false;
  }
}

async function handlePasteAttempt(event, editable, pastedText) {
  const resp = await classifyAndRedact(pastedText, "paste");
  if (!resp?.ok) return;
  if (!resp.policy?.clipboardProtection) return;
  if (resp.decision.action === "ALLOW") return;

  event.preventDefault();
  const replacement = resp.redactedText || pastedText;
  insertTextAtCursor(editable, replacement);
  toast(`Paste sanitized (${resp.analysis?.risk || 0}/100).`);
  await appendResolution({
    action: "PASTE_REDACTED",
    risk: resp.analysis?.risk || 0,
    categories: resp.analysis?.categories || [],
    counts: resp.analysis?.counts || {},
    note: "Clipboard protection replaced pasted content with sanitized text.",
  });
}

function insertTextAtCursor(editable, text) {
  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    const start = editable.selectionStart ?? editable.value.length;
    const end = editable.selectionEnd ?? editable.value.length;
    const next = editable.value.slice(0, start) + text + editable.value.slice(end);
    editable.value = next;
    const caret = start + text.length;
    editable.selectionStart = caret;
    editable.selectionEnd = caret;
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  editable.focus();
  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    setEditableText(editable, getEditableText(editable) + text);
  }
}

async function executeSend(editable, text, triggerMeta) {
  setEditableText(editable, text);
  await new Promise((resolve) => setTimeout(resolve, 16));
  PF_STATE.bypassUntil = Date.now() + 700;

  if (triggerMeta.type === "button" && triggerMeta.button?.isConnected) {
    triggerMeta.button.click();
    return;
  }

  if (triggerMeta.type === "form" && triggerMeta.form?.isConnected) {
    triggerMeta.form.requestSubmit();
    return;
  }

  if (clickKnownSendButton()) return;

  editable.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
  editable.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );

  const form = editable.closest("form");
  if (form) form.requestSubmit();
}

function clickKnownSendButton() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[title*="Send" i]',
    'button[aria-label*="Run" i]',
    'button[type="submit"]',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const target = candidates.find((el) => isButtonClickable(el));
    if (target) {
      target.click();
      return true;
    }
  }
  return false;
}

function isButtonClickable(button) {
  if (!(button instanceof HTMLElement)) return false;
  if ((button instanceof HTMLButtonElement || button instanceof HTMLInputElement) && button.disabled) return false;
  const rect = button.getBoundingClientRect();
  if (rect.width < 6 || rect.height < 6) return false;
  const style = getComputedStyle(button);
  return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
}

async function classifyAndRedact(text, trigger) {
  return sendMessage({
    type: "CLASSIFY_AND_REDACT",
    payload: {
      text,
      url: location.href,
      trigger,
    },
  });
}

async function appendResolution(payload) {
  await sendMessage({
    type: "LEDGER_APPEND",
    payload: {
      ...payload,
      domain: location.hostname,
      trigger: "content_resolution",
      eventType: "user_resolution",
    },
  });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response." });
    });
  });
}

function toast(message) {
  const node = document.createElement("div");
  node.textContent = message;
  node.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "padding:10px 12px",
    "border-radius:10px",
    "font:12px/1.3 system-ui,sans-serif",
    "background:#111827",
    "color:#f9fafb",
    "box-shadow:0 8px 20px rgba(0,0,0,0.3)",
    "opacity:0.98",
  ].join(";");
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}

function showBlockModal({ analysis, redactedText, redactions, canOverride, holdMs }) {
  return new Promise((resolve) => {
    let timer = null;
    let start = 0;

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:rgba(15,23,42,0.62)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:20px",
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "width:min(720px,96vw)",
      "max-height:92vh",
      "overflow:auto",
      "background:#ffffff",
      "color:#111827",
      "border-radius:16px",
      "padding:16px",
      "box-shadow:0 20px 48px rgba(15,23,42,0.35)",
      "font:13px/1.45 system-ui,sans-serif",
    ].join(";");

    const categoryText = (analysis.categories || []).join(", ") || "Unknown";
    const redactionSummary = summarizeRedactions(redactions || []);

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;">
        <div style="font-weight:700;font-size:15px;">Prompt Firewall blocked this send</div>
        <div style="font-size:12px;background:#111827;color:#fff;padding:4px 8px;border-radius:999px;">Risk ${escapeHtml(String(analysis.risk || 0))}/100</div>
      </div>
      <div style="font-size:12px;color:#4b5563;margin-bottom:10px;">Detected categories: <b>${escapeHtml(categoryText)}</b></div>
      <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:10px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Diff summary (no raw values shown)</div>
          <div style="font-size:12px;color:#334155">${escapeHtml(redactionSummary || "No redactions generated.")}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Redacted preview</div>
          <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.35 ui-monospace,Consolas,monospace;color:#0f172a;max-height:210px;overflow:auto;">${escapeHtml(redactedText || "")}</pre>
        </div>
      </div>
      <div id="pf-override-zone" style="display:none;margin-bottom:10px;border:1px solid #f59e0b;background:#fffbeb;border-radius:12px;padding:10px;">
        <div style="font-weight:600;font-size:12px;color:#92400e;margin-bottom:6px;">Step-up required</div>
        <div style="font-size:12px;color:#78350f;margin-bottom:8px;">Hold confirm for ${Math.round(holdMs / 100) / 10}s to send original text.</div>
        <div style="height:8px;border-radius:999px;background:#fde68a;overflow:hidden;margin-bottom:8px;">
          <div id="pf-hold-progress" style="width:0%;height:100%;background:#f59e0b;"></div>
        </div>
        <button id="pf-hold-btn" style="padding:8px 10px;border:0;border-radius:10px;background:#92400e;color:#fff;font-weight:600;cursor:pointer;">Hold to confirm override</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
        <button id="pf-cancel" style="padding:8px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;cursor:pointer;">Cancel</button>
        <button id="pf-send-redacted" style="padding:8px 10px;border:0;background:#111827;color:#fff;border-radius:10px;cursor:pointer;">Send redacted</button>
        <button id="pf-send-rewrite" style="padding:8px 10px;border:0;background:#1d4ed8;color:#fff;border-radius:10px;cursor:pointer;">Send redacted + safe rewrite</button>
        ${
          canOverride
            ? '<button id="pf-request-override" style="padding:8px 10px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:10px;cursor:pointer;">Request override</button>'
            : '<button disabled style="padding:8px 10px;border:1px solid #e2e8f0;background:#f8fafc;color:#94a3b8;border-radius:10px;">Override disabled for secrets</button>'
        }
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cleanup = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      window.removeEventListener("keydown", onEsc, true);
      overlay.remove();
    };

    const done = (choice) => {
      cleanup();
      resolve(choice);
    };

    const onEsc = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        done("CANCEL");
      }
    };

    window.addEventListener("keydown", onEsc, true);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) done("CANCEL");
    });

    card.querySelector("#pf-cancel")?.addEventListener("click", () => done("CANCEL"));
    card.querySelector("#pf-send-redacted")?.addEventListener("click", () => done("SEND_REDACTED"));
    card.querySelector("#pf-send-rewrite")?.addEventListener("click", () => done("SEND_REWRITE"));

    const overrideButton = card.querySelector("#pf-request-override");
    const zone = card.querySelector("#pf-override-zone");
    const holdButton = card.querySelector("#pf-hold-btn");
    const progress = card.querySelector("#pf-hold-progress");

    const resetHold = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      start = 0;
      if (progress) progress.style.width = "0%";
    };

    const startHold = () => {
      if (!holdButton || !progress) return;
      resetHold();
      start = Date.now();
      timer = setInterval(() => {
        const elapsed = Date.now() - start;
        const pct = Math.max(0, Math.min(1, elapsed / holdMs));
        progress.style.width = `${Math.round(pct * 100)}%`;
        if (pct >= 1) {
          resetHold();
          done("OVERRIDE_ORIGINAL");
        }
      }, 24);
    };

    if (overrideButton && zone) {
      overrideButton.addEventListener("click", () => {
        zone.style.display = "block";
      });
    }

    if (holdButton) {
      holdButton.addEventListener("mousedown", startHold);
      holdButton.addEventListener("touchstart", startHold, { passive: true });
      holdButton.addEventListener("mouseup", resetHold);
      holdButton.addEventListener("mouseleave", resetHold);
      holdButton.addEventListener("touchend", resetHold);
      holdButton.addEventListener("touchcancel", resetHold);
    }
  });
}

function summarizeRedactions(redactions) {
  if (!Array.isArray(redactions) || redactions.length === 0) return "";
  const counts = {};
  for (const item of redactions) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" • ");
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
