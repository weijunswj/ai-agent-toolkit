# n8n Local Setup

Beginner-facing source index for this toolkit module.

## Start Here

| Need | Open |
| --- | --- |
| Local Windows setup | [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) |
| Always-on hosted setup | [Page 2 - Hostinger VPS](./Page%202%20-%20Hostinger%20VPS.md) |

Start with Local Setup for Docker Desktop on your own computer. Use Hostinger VPS for a public server.

## Supporting Materials

| Need | Open |
| --- | --- |
| Local stack templates | [templates/local-stack/](./templates/local-stack/) |

## Skills-First Routing

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync.

Start with [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md). Optional AI-coding-agent MCP feature references are secondary and only for users intentionally enabling n8n MCP for an AI coding agent.

## Optional AI-Coding-Agent MCP Feature References

This section is for using AI coding agents to work on n8n workflows.

| Platform | Setup guide | Config template |
| --- | --- | --- |
| Codex | [mcp setup - codex.md](./mcp%20setup%20-%20codex.md) | [codex-mcp-config.md](./templates/mcp-configs/codex-mcp-config.md) |
| Claude Code | [mcp setup - claude code.md](./mcp%20setup%20-%20claude%20code.md) | [claude-mcp-config.md](./templates/mcp-configs/claude-mcp-config.md) |
| OpenCode | [mcp setup - opencode.md](./mcp%20setup%20-%20opencode.md) | [opencode-mcp-config.md](./templates/mcp-configs/opencode-mcp-config.md) |
| Antigravity | [mcp setup - antigravity.md](./mcp%20setup%20-%20antigravity.md) | [antigravity-mcp-config.md](./templates/mcp-configs/antigravity-mcp-config.md) |

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Open |
| --- | --- |
| Generic AI coding-agent rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n workflow and live-action rules | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |

## Safety Notes

- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, or encryption keys into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
