# n8n Local Setup

Beginner-facing source index for this toolkit module.

## Start Here

| Need | Open |
| --- | --- |
| Local Windows setup | [1. Local Setup](./1.%20local%20setup.md) |
| Always-on hosted setup | [2. Hostinger VPS](./2.%20hostinger%20vps.md) |

Start with Local Setup for Docker Desktop on your own computer. Use Hostinger VPS for a public server.

## Supporting References

MCP setup pages are supporting references. They are not equal start paths for local setup.

| Need | Open |
| --- | --- |
| Codex MCP setup | [Codex MCP Setup](./mcp%20setup%20-%20codex.md) |
| Claude Code MCP setup | [Claude Code MCP Setup](./mcp%20setup%20-%20claude%20code.md) |
| OpenCode MCP setup | [OpenCode MCP Setup](./mcp%20setup%20-%20opencode.md) |
| Antigravity MCP setup | [Antigravity MCP Setup](./mcp%20setup%20-%20antigravity.md) |
| Local stack templates | [templates/local-stack/](./templates/local-stack/) |
| MCP config templates | [codex-mcp-config.md](./codex-mcp-config.md), [claude-mcp-config.md](./claude-mcp-config.md), [opencode-mcp-config.md](./opencode-mcp-config.md), [antigravity-mcp-config.md](./antigravity-mcp-config.md) |

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Open |
| --- | --- |
| Generic AI coding-agent rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n workflow and live-action rules | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |

## Safety Notes

- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, encryption keys, or MCP tokens into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
