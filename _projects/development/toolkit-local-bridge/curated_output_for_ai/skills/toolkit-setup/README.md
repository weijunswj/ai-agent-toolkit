<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this README as a short install/identity note for the compact setup router.
-->

# Toolkit Setup Skill

Copy the whole [toolkit-setup](./) skill folder when an agent needs to recognise AI Agent Toolkit plugin setup, local bridge setup, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, sync, disable, stale bridge state, or bridge troubleshooting requests.

This skill is a compact router only. Bridge setup remains Toolkit setup infrastructure implemented by `repo/scripts/toolkit-local-bridge.cjs` and documented in `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`. Windows-safe post-install hook repair for installed Codex plugin roots lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`.

Native plugin setup is platform-specific but routed through one host-aware orchestrator: Codex setup prompts run `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main`, while Claude Code setup prompts run `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --host claude-code`. Codex uses the Codex-only `repo/scripts/setup-codex-toolkit-plugin.cjs` helper and `.codex-plugin/plugin.json`; Claude Code verifies `.claude-plugin/plugin.json` and uses Claude Code's native plugin install/trust flow when needed. Both platforms share `repo/scripts/toolkit-local-bridge.cjs` for repo auto-update, OpenCode sync, and Antigravity 2 sync after native plugin setup.

On Windows, run Codex native plugin operations through the app-managed executable under `%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe` (or pass `--codex-cli` explicitly) rather than the bare `codex` command.

If same-version Codex plugin cache refresh keeps timing out on the same stale files, stop the long-running add attempt, avoid concurrent `codex plugin add` retries, run one clean write/verify with the app-managed CLI, and inspect Codex config/cache state before touching shared bridge targets.

Routine setup should run `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main`, with `--host claude-code` in Claude Code. The orchestrator shows one upfront checklist, creates or verifies the managed clean `main` checkout at `~/.ai-agent-toolkit/source/ai-agent-toolkit` or `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`, verifies or refreshes only the current host's native Toolkit plugin path, persists update-report and retention preferences, and prints a final summary. Reserve the full `toolkit-local-bridge.test.cjs` suite for bridge changes, PR review, or release validation.

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

OpenCode and Antigravity 2 sync are app-facing after explicit target enablement: OpenCode uses the user OpenCode skill folder, and Antigravity 2 uses the Gemini config plugin root. Antigravity 2 detection is separate from optional Python `ag2` package detection.

It intentionally does not create one skill per bridge command.
