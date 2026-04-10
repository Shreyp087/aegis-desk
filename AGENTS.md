## Communication Rules

You have access to a Telegram MCP server with these tools:

- `notify_user` — send a one-way status message
- `ask_user` — send a question and WAIT for my reply before proceeding
- `send_file` — send me a file (use for diffs, logs, reports)

### When to use them:

- Task started → notify_user "🚀 Starting: [task name]"
- Need a decision → ask_user "Should I [describe choice A] or [choice B]?"
- Task complete → notify_user "✅ Done: [summary of what changed]"
- Error/blocked → ask_user "❌ Blocked: [explain issue]. How should I proceed?"
- Send output files when relevant → send_file
