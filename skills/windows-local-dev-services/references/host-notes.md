# Host-specific notes

These notes name one agent app each. Use only the part that matches the agent you are running in. The main skill applies to any agent.

## Installing the skill folder

- Claude Code: copy the skill folder into `~/.claude/skills/` for personal use or `.claude/skills/` for project use.

## Relaunch parameter for sandboxed background servers

- Codex: its sandboxed shells may exit or kill background localhost servers when the shell command returns. Relaunch with `sandbox_permissions: require_escalated` when available, then repeat the same log and HTTP health checks.
