<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this README as a short install/identity note for the compact setup router.
-->

# Toolkit Setup Skill

Copy the whole [toolkit-setup](./) skill folder when an agent needs to recognise AI Agent Toolkit plugin setup, local bridge setup, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, sync, disable, stale bridge state, or bridge troubleshooting requests.

This skill is a compact router only. Bridge setup remains Toolkit setup infrastructure implemented by `repo/scripts/toolkit-local-bridge.cjs` and documented in `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`. Windows-safe post-install hook repair for installed Codex plugin roots lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`.

Native plugin setup is platform-specific but routed through one host-aware orchestrator: Codex setup prompts run `node repo/scripts/setup-toolkit.cjs --execute`, while Claude Code setup prompts run `node repo/scripts/setup-toolkit.cjs --execute --host claude-code`. Codex uses the Codex-only `repo/scripts/setup-codex-toolkit-plugin.cjs` helper and `.codex-plugin/plugin.json`; Claude Code verifies `.claude-plugin/plugin.json` and uses Claude Code's native plugin install/trust flow when needed. Both platforms share `repo/scripts/toolkit-local-bridge.cjs` for repo auto-update, OpenCode sync, and Antigravity 2 sync after native plugin setup.

On Windows, run Codex native plugin operations through the app-managed executable under `%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe` (or pass `--codex-cli` explicitly) rather than the bare `codex` command.

If same-version Codex plugin cache refresh keeps timing out on the same stale files, stop the long-running add attempt, avoid concurrent `codex plugin add` retries, run one clean write/verify with the app-managed CLI, and inspect Codex config/cache state before touching shared bridge targets.

Routine setup should run `node repo/scripts/setup-toolkit.cjs --execute` from this repo, with `--host claude-code` in Claude Code. The orchestrator verifies or refreshes the host-native Toolkit plugin path before validation, bridge setup, or target sync, then runs fast validation such as `validate-toolkit.cjs` and `toolkit-local-bridge-hook-light.test.cjs`. Reserve the full `toolkit-local-bridge.test.cjs` suite for bridge changes, PR review, or release validation.

OpenCode and Antigravity 2 sync are app-facing after explicit target enablement: OpenCode uses the user OpenCode skill folder, and Antigravity 2 uses the Gemini config plugin root. Antigravity 2 detection is separate from optional Python `ag2` package detection.

It intentionally does not create one skill per bridge command.
