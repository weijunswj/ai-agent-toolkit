DELIVERY
- Write the full report to {{report_dir}}/latest.md (overwrite), then read it back. Call threads by title with links, never bare ids.
- Send ONE message with mcp__hearthbot__message_coordinator, at most 1,500 characters: the report's first line(s), the most important bullets, then "Full: {{report_dir}}/latest.md". If the send fails, retry once with only the first line(s) and the file path. If both fail, post the same text in this thread as statements and say plainly that delivery to the coordinator failed; never claim it was delivered.
[fresh]- After delivery (or the failure post), resolve this run's own thread with mcp__hearthbot__set_thread_resolved (resolved: true), then end the turn with mcp__hearthbot__no_reply_needed.
[bound]- Never resolve this home thread. End the turn with mcp__hearthbot__no_reply_needed.
