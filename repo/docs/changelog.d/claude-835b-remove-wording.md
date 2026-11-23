### Added

- **Remove Toolkit:** `remove toolkit` now also removes Codex setup's journal once its last step finished (an unfinished one stays as recovery evidence) and the update reports the bridge writes to the temp folder, once no Toolkit plugin is installed.

### Changed

- **Remove Toolkit:** the Claude Code settings setup turned on are listed as Claude Code's own settings, left exactly as they are, and the recovery records folder is kept as evidence instead of being called someone else's file. Removal never deletes a key from the credential store and has no step for other plugins.
- **n8n skills:** setup only copies the official n8n skills; it no longer turns the n8n Skills plugin off in Claude Code or tells you to turn it off in Codex.
- **Governance check:** no message or document tells you to type `toolkit governance check` any more. Owner-facing steps say to ask your agent to check governance; agent and workflow text names the script, `toolkit-governance.cjs check`.
- **Repository files:** `repository-agent-rules` expects the one-line `@AGENTS.md` CLAUDE.md only where Claude Code would otherwise miss AGENTS.md: the repository has its own CLAUDE.md and the "Read AGENTS.md as well as CLAUDE.md" setting is off.
