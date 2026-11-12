Title: refresh toolkit keeps your answers with no questions

### Changed

- `refresh toolkit` (and `toolkit refresh` or plain `refresh`) now runs setup with `--refresh`: it updates Toolkit and, while the questions match the last bank answered on this computer, keeps every current answer (each row's `A. Keep current`) with no bank, in Codex and in Claude Code. An installed, turned-on plugin that the update left behind is refreshed.
- A new or different question, no saved answers yet, or a missing or turned-off plugin shows the full bank as for `setup toolkit`, with a line naming each new or different row. A recommendation you already declined does not bring the bank back.
- `setup toolkit` still shows the bank. An answered bank saves each row's question shape and the recommendation it showed under `~/.ai-agent-toolkit/user-state/setup-question-shapes.json`, one record per app, with no setting values, paths or keys.
- A refresh never approves a Codex configuration proposal, a scheduled-task standing approval or a native trust step, and `--refresh` refuses choice flags, `--yes-recommended`, proposal approvals and `--plan`.
