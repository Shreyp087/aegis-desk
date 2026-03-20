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

function SectionLabel({ children }: { children: string }) {
  return <div className="text-xs font-mono font-medium uppercase tracking-widest text-aegis-dim">{children}</div>;
}

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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-aegis-border bg-aegis-elevated p-4">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Email Thread</SectionLabel>
            <span className="aegis-time">{emailWords} words</span>
          </div>
          <textarea
            className="aegis-textarea min-h-64 flex-1"
            value={emailText}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="Paste the incoming thread here. Keep raw headers or quoted sections if you want the agent to reason over them."
          />
        </div>

        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-aegis-border bg-aegis-elevated p-4">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Supporting Context</SectionLabel>
            <span className="aegis-time">{docWords} words</span>
          </div>
          <textarea
            className="aegis-textarea min-h-64 flex-1"
            value={docText}
            onChange={(event) => setDocText(event.target.value)}
            placeholder="Paste attachment text, policy snippets, or any external supporting notes."
          />
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-aegis-border bg-aegis-elevated p-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Command</SectionLabel>
          <span className="aegis-time">{commandLength} chars</span>
        </div>
        <textarea
          className="aegis-textarea min-h-28"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Define the outcome clearly: assess risk, verify claims, draft a response, summarize evidence."
        />
        <div className="aegis-chip-row">
          {COMMAND_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setCommand(suggestion)} className="aegis-chip">
              {suggestion}
            </button>
          ))}
        </div>
        <div className="text-xs text-aegis-muted">Tip: press `Ctrl/Cmd + Enter` anywhere in Agent Desk to run the current analysis command.</div>
      </div>
    </div>
  );
}
