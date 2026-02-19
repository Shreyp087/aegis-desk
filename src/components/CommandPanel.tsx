"use client";

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
  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Content: 2 sub-rows */}
      <div className="flex-1 min-h-0 space-y-2">
        {/* Sub-row 1: 2 columns for Email and Doc */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Email */}
          <div className="flex flex-col">
            <label className="block text-xs text-neutral-300 font-semibold mb-2">
              Email
            </label>
            <textarea
              className="flex-1 min-h-[300px] p-3 rounded-xl bg-white/5 border border-white/10 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-sm placeholder:text-neutral-500 transition-all duration-300 hover:bg-white/10"
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
              className="flex-1 min-h-[300px] p-3 rounded-xl bg-white/5 border border-white/10 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-sm placeholder:text-neutral-500 transition-all duration-300 hover:bg-white/10"
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
            className="w-full p-3 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 text-sm placeholder:text-neutral-500 transition-all duration-300 hover:bg-white/10"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="What should the agent do?"
          />
          <div className="mt-1 text-[11px] text-neutral-500">
            {/* Example: “Summarize, verify entities with Linkup, draft reply, create ICS.” */}
          <br></br>
          {/* <hr></hr> */}
          </div>
        </div>
      </div>
    </div>
  );
}
