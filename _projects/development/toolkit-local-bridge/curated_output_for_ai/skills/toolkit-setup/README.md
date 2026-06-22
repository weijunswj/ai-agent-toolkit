<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this README as a short install/identity note for the compact setup router.
-->

# Toolkit Setup Skill

Copy the whole [toolkit-setup](./) skill folder when an agent needs to recognise AI Agent Toolkit plugin setup, local bridge setup, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, sync, disable, stale bridge state, or bridge troubleshooting requests.

This skill is a compact router only. Bridge setup remains Toolkit setup infrastructure implemented by `repo/scripts/toolkit-local-bridge.cjs` and documented in `repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md`. Windows-safe post-install hook repair for installed Codex plugin roots lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`.

OpenCode and Antigravity 2 sync are app-facing after explicit target enablement: OpenCode uses the user OpenCode skill folder, and Antigravity 2 uses the Gemini config plugin root. Antigravity 2 detection is separate from optional Python `ag2` package detection.

It intentionally does not create one skill per bridge command.
