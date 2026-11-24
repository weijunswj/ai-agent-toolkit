# Host-Specific Install Notes

These notes cover install details that depend on the coding agent app or the setup tool, plus the sibling skill used for Hostinger VPS work. Normal n8n environment setup does not need them.

## Hostinger VPS Routing

For Hostinger VPS plus Coolify setup or server maintenance, use `codex-ssh-hostinger-coolify-setup-maintainer` first. Return to this skill for n8n-specific deployment guidance after Coolify exists.

## Official n8n Skills Install

- `setup toolkit` ships the official n8n skills as plain skill folders, pinned and copied unchanged into this app's skills folder (Claude Code `~/.claude/skills`, Codex `~/.agents/skills`) and into Antigravity's `~/.gemini/config/skills` when Antigravity is installed. No plugin, hook or script comes with them. Folders you copied yourself are reported and never changed, including older-release copies (names without `-official`, or in Antigravity's older `~/.gemini/antigravity/skills`) that would load twice.
- With the skills copied, the `n8n-skills@n8n-io` plugin would load them twice. Setup never turns it on or off; turn it off yourself in the app's plugin settings.
- Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks. Local Antigravity plugin-scoped folder installs also do not include the official n8n plugin hooks.

## Generic Agent Rules

- Generic agent rules: the Toolkit global rules that `setup toolkit` installs; a governed repository needs no rules copy of its own, since its rules arrive at session start
