"use client";

const COMMAND_SUGGESTIONS = [
  "Summarize and verify key claims with sources.",
  "Identify risks and propose the safest next action.",
  "Draft a concise reply and schedule follow-up.",
];

function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

type CommandPanelProps = {
  emailText: string;
  setEmailText: (value: string) => void;
  docText: string;
  setDocText: (value: string) => void;
  command: string;
  setCommand: (value: string) => void;
};

export default function CommandPanel({
  emailText,
  setEmailText,
  docText,
  setDocText,
  command,
  setCommand,
}: CommandPanelProps) {
  const emailWords = countWords(emailText);
  const docWords = countWords(docText);
  const commandLength = command.trim().length;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="field-shell field-shell-email flex flex-col">
            <div className="field-head">
              <label className="field-label">Email</label>
              <span className="field-meta">{emailWords} words</span>
            </div>
            <textarea
              className="field-input flex-1 min-h-[180px] sm:min-h-[220px] md:min-h-[300px] resize-none"
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste email thread here..."
            />
          </div>

          <div className="field-shell field-shell-doc flex flex-col">
            <div className="field-head">
              <label className="field-label">Document Text</label>
              <span className="field-meta">{docWords} words</span>
            </div>
            <textarea
              className="field-input flex-1 min-h-[180px] sm:min-h-[220px] md:min-h-[300px] resize-none"
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              placeholder="Paste report / attachment text here..."
            />
          </div>
        </div>

        <div className="field-shell field-shell-command flex flex-col">
          <div className="field-head">
            <label className="field-label">Command</label>
            <span className="field-meta">{commandLength} chars</span>
          </div>
          <textarea
            className="field-input"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={4}
            placeholder="What should the agent do?"
          />
          <div className="command-chip-row">
            {COMMAND_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setCommand(suggestion)}
                className="command-chip"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-[var(--muted)]">
            Tip: press Ctrl/Cmd + Enter anywhere on Agent tab to run quickly.
          </div>
        </div>
      </div>
    </div>
  );
}
