Title: usage reader

### Added

- `repo/scripts/toolkit-usage-report.cjs`: reads Claude Code and Codex session transcripts and writes one JSON report of token and tool counts per session, so the runs that use up usage limits can be measured before anything is changed to save them. Per session it gives the models, first and last activity, model turns (helper turns among them), input, cache-write, cache-read and output tokens, the cache hit share, tool calls by name, repeat reads of one file, shell sleeps, wake-ups scheduled, helpers started and a run type (hourly, daily, weekly, coordinator, G0, G1, G2, merge train or other), plus totals per run type. A reply Claude Code writes as several lines counts once, and a repeated Codex token count is skipped. The report never holds prompt, reply, thinking, tool or file text: file paths become ids that match only within one report, and a report that would hold anything shaped like a secret is refused and not written.
