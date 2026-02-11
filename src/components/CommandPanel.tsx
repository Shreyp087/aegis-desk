"use client";

export default function CommandPanel({
  emailText,
  setEmailText,
  docText,
  setDocText,
  command,
  setCommand,
  onRun,
}: any) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 px-4 py-3 border-b border-neutral-800">
        <div>
          <div className="font-semibold text-sm">Command + Inputs</div>
          <div className="text-xs text-neutral-500">
            Paste email + doc text, then give one natural-language instruction.
          </div>
        </div>
        <button
          onClick={onRun}
          className="px-3 py-2 rounded-lg bg-white text-black font-semibold hover:bg-neutral-200 transition text-sm"
        >
          Run Agent
        </button>
      </div>

      {/* Content: 2 sub-rows */}
      <div className="flex-1 min-h-0 p-4 pb-0 space-y-2">
        {/* Sub-row 1: 2 columns for Email and Doc */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Email */}
          <div className="flex flex-col">
            <label className="block text-xs text-neutral-300 font-semibold mb-2">
              Email
            </label>
            <textarea
              className="flex-1 min-h-[300px] p-2 rounded-lg bg-neutral-950 border border-neutral-800 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-600 text-sm"
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste email thread here..."
            />
          </div>

          {/* Document */}
          <div className="flex flex-col">
            <label className="block text-xs text-neutral-300 font-semibold mb-2">
              Document text <span className="text-neutral-500 font-normal">(PDF pasted for MVP)</span>
            </label>
            <textarea
              className="flex-1 min-h-[300px] p-2 rounded-lg bg-neutral-950 border border-neutral-800 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-600 text-sm"
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              placeholder="Paste report / attachment text here..."
            />
          </div>
        </div>

        {/* Sub-row 2: Full width Command */}
        <div className="flex flex-col">
          <label className="block text-xs text-neutral-300 font-semibold mb-2">
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
