"use client";

import { useMemo, useState } from "react";

function preview(text: string, maxChars = 140) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}

export default function CommandPanel({
  emailText,
  setEmailText,
  docText,
  setDocText,
  command,
  setCommand,
  onRun,
}: any) {
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);

  const emailPreview = useMemo(() => preview(emailText), [emailText]);
  const docPreview = useMemo(() => preview(docText), [docText]);

  return (
    <div className="h-full min-h-0 rounded-xl border border-neutral-800 bg-neutral-950 p-3 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-sm">Command + Inputs</div>
          <div className="text-xs text-neutral-500">
            Compact by default • Expand when needed
          </div>
        </div>
        <button
          onClick={onRun}
          className="px-3 py-2 rounded-lg bg-white text-black font-semibold hover:bg-neutral-200 transition text-sm"
        >
          Run Agent
        </button>
      </div>

      {/* Content (static height sections, no internal scrolling) */}
      <div className="space-y-3">
        {/* EMAIL CARD */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
            <div className="text-xs text-neutral-300 font-semibold">Email</div>
            <button
              type="button"
              onClick={() => setEmailExpanded((v) => !v)}
              className="text-xs px-2 py-1 rounded-md border border-neutral-700 hover:bg-neutral-900 transition"
            >
              {emailExpanded ? "Collapse" : "Expand"}
            </button>
          </div>

          {/* Preview */}
          {!emailExpanded ? (
            <div className="px-3 py-2">
              <div className="text-xs text-neutral-400 mb-1">Preview</div>
              <div className="text-xs text-neutral-200">
                {emailPreview || (
                  <span className="text-neutral-500">Paste email thread here…</span>
                )}
              </div>
            </div>
          ) : (
            <div className="px-3 py-2">
              <textarea
                className="w-full p-2 rounded-lg bg-neutral-950 border border-neutral-800 h-36 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-600 text-sm"
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste email thread here..."
              />
              <div className="mt-1 text-[11px] text-neutral-500">
                Tip: include sender + subject lines for better entity extraction.
              </div>
            </div>
          )}
        </div>

        {/* DOCUMENT CARD */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
            <div className="text-xs text-neutral-300 font-semibold">
              Document text
              <span className="text-neutral-500 font-normal"> (PDF pasted for MVP)</span>
            </div>
            <button
              type="button"
              onClick={() => setDocExpanded((v) => !v)}
              className="text-xs px-2 py-1 rounded-md border border-neutral-700 hover:bg-neutral-900 transition"
            >
              {docExpanded ? "Collapse" : "Expand"}
            </button>
          </div>

          {/* Preview */}
          {!docExpanded ? (
            <div className="px-3 py-2">
              <div className="text-xs text-neutral-400 mb-1">Preview</div>
              <div className="text-xs text-neutral-200">
                {docPreview || (
                  <span className="text-neutral-500">Paste report / attachment text here…</span>
                )}
              </div>
            </div>
          ) : (
            <div className="px-3 py-2">
              <textarea
                className="w-full p-2 rounded-lg bg-neutral-950 border border-neutral-800 h-36 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-600 text-sm"
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Paste report / attachment text here..."
              />
              <div className="mt-1 text-[11px] text-neutral-500">
                Tip: paste only the relevant excerpt to keep latency low.
              </div>
            </div>
          )}
        </div>

        {/* COMMAND */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2">
          <label className="block text-xs text-neutral-300 font-semibold mb-1">
            Command
          </label>
          <input
            className="w-full p-2 rounded-lg bg-neutral-950 border border-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-600 text-sm"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="What should the agent do?"
          />
          <div className="mt-1 text-[11px] text-neutral-500">
            Example: “Summarize, verify entities with Linkup, draft reply, create ICS.”
          </div>
        </div>
      </div>
    </div>
  );
}