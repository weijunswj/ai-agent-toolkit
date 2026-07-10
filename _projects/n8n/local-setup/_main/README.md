# n8n Local Setup

Beginner-facing source index for this toolkit module.

## Start Here

| Need | Open |
| --- | --- |
| Local Windows setup | [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) |
| Always-on hosted setup | [Page 2 - Hostinger Coolify VPS n8n](./Page%202%20-%20Hostinger%20VPS.md) |
| Production self-hosting from local/CGNAT machine | [Page 3 - Production Self-Hosting With Cloudflare Tunnel](./Page%203%20-%20Production%20Self-Hosting%20With%20Cloudflare%20Tunnel.md) |

Start with Local Setup for Docker Desktop on your own computer. Use Page 1's ngrok path for development webhooks and OAuth callbacks. Use Page 3 for production self-hosting from a local/CGNAT machine through Cloudflare Tunnel. Use Page 2 when Coolify already exists on a Hostinger VPS and you want to deploy n8n inside Coolify. For Hostinger VPS plus Coolify setup or server maintenance, use [`codex-ssh-hostinger-coolify-setup-maintainer`](../../development/hostinger-coolify-production-guide/) first, then return to Page 2 for n8n-specific deployment guidance.

## Supporting Materials

| Need | Open |
| --- | --- |
| Local stack templates | [templates/.n8n-local/](./templates/.n8n-local/) |
| Production Cloudflare stack templates | [templates/.n8n-production-cloudflare/](./templates/.n8n-production-cloudflare/) |

## Skills-First Routing

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync.

Start with [Page 1 - Local Setup](./Page%201%20-%20Local%20Setup.md) for dev or [Page 3 - Production Self-Hosting With Cloudflare Tunnel](./Page%203%20-%20Production%20Self-Hosting%20With%20Cloudflare%20Tunnel.md) for local/CGNAT production hosting. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are secondary and only for users intentionally enabling n8n workflow work through an AI coding agent.

## [Official n8n Skills](https://github.com/n8n-io/skills) And MCP References

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
- Do not run live Cloudflare, DNS, tunnel, Docker, credential, workflow activation, import/export, or production actions without explicit current-turn approval naming the target and operation.
- Do not paste real API tokens, webhook secrets, passwords, or encryption keys into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
