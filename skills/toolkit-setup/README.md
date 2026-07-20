<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.toolkit-local-bridge
Source: _projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.toolkit-local-bridge
Review rule: Keep this README as a short install/identity note for the compact setup router.
-->

# Toolkit Setup Skill

Copy the whole [toolkit-setup](./) skill folder when an agent needs to recognise AI Agent Toolkit plugin setup, local bridge setup, repo-backed Toolkit auto-update, OpenCode bridge support, Antigravity 2 adapter support, bridge audit, sync, disable, stale bridge state, or bridge troubleshooting requests.

This README is only an install/identity note. Runtime guidance lives in `SKILL.md`, `repo/scripts/setup-toolkit.cjs`, `repo/scripts/toolkit-local-bridge.cjs`, and `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`.

Routine setup routes through the host-aware orchestrator in the managed checkout when it exists:

- Windows Codex: `node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main`
- POSIX Codex: `node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main`
- Claude Code: append `--host claude-code` to the managed checkout command.

Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing. After bootstrap creates the managed checkout, hand off to the managed checkout script.

Exit code `23` is an intentional pause only after the managed child emits exactly one complete stdout bank and the delegating parent acknowledges visible forwarding. A chat host must surface the complete compact bank before offering any recommended-default shortcut. Missing, malformed, wrong-stream, failed, timed-out, signalled, recursive, or invalid-identity protocol output fails closed without retry, fallback, approval, or writes. Do not rerun with `--yes-recommended` unless the user explicitly requested the displayed recommended choices in the current turn.

Managed delegation launches the child before waiting for non-TTY stdin EOF. It streams exact input bytes under a fixed limit; the child emits the bank before reading unresolved input and binds it to exact byte length, SHA-256, marker counts, and question count. The parent waits for and validates the exact bounded stdout payload regardless of control/stdout delivery order, forwards it once, and only then acknowledges visibility. Length/digest mismatch or oversized input, output, or metadata fails closed.

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Codex and Claude Code native plugin handling is host-local; OpenCode and Antigravity 2 sync remain explicit opt-ins.

It intentionally does not create one skill per bridge command.
