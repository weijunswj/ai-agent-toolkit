<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this README as a short install/identity note for the compact setup router.
-->

# Toolkit Setup Skill

Copy the whole [toolkit-setup](./) skill folder when an agent needs to recognise AI Agent Toolkit plugin setup, local bridge setup, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, sync, disable, stale bridge state, or bridge troubleshooting requests.

This README is only an install/identity note. Runtime guidance lives in `SKILL.md`, `repo/scripts/setup-toolkit.cjs`, `repo/scripts/toolkit-local-bridge.cjs`, and `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`.

Routine setup routes through the host-aware orchestrator:

- Codex: `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main`
- Claude Code: `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --host claude-code`

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Codex and Claude Code native plugin handling is host-local; OpenCode and Antigravity 2 sync remain explicit opt-ins.

It intentionally does not create one skill per bridge command.
