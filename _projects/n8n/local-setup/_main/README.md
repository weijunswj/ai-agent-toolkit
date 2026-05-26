# Codex + n8n Local Setup

Opinionated local n8n setup for agents and beginners.

This project has one primary local route: [1. Local Setup](./1.%20local%20setup.md). It is the one-stop-shop guide for Docker Compose, Postgres, ngrok, `n8n-local.cmd`, the PowerShell menu, update checks, URLs, MCP setup, agent platform setup, troubleshooting, and daily commands.

VPS, Hostinger, Coolify, and always-on public hosting stay separate in [4. VPS Hosting](./4.%20vps%20hosting.md).

## Fast Path

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and [Node.js LTS](https://nodejs.org/en/download).
2. Create a local stack folder outside this repo. The folder can live anywhere, but this guide uses `%USERPROFILE%\Desktop\n8n-local`.
3. Copy the local stack templates into that folder: [docker-compose.yml](./templates/local-stack/docker-compose.yml), [.env.example](./templates/local-stack/.env.example), [n8n-local.cmd](./templates/local-stack/n8n-local.cmd), and the [scripts folder](./templates/local-stack/scripts/).
4. Copy `.env.example` to `.env`.
5. Paste placeholder replacements into `.env`, not PowerShell.
6. Create the owner account locally at [http://localhost:5678](http://localhost:5678) before starting the public tunnel.
7. Use `n8n-local.cmd` for daily start, update, inspect logs, open URLs, and back up Postgres.
8. Use the ngrok HTTPS URL from `WEBHOOK_URL` for webhook and OAuth callback testing only when a public tunnel is needed.
9. Copy the [Codex MCP config](./templates/codex-mcp-config.md), [Claude MCP config](./templates/claude-mcp-config.md), [OpenCode MCP config](./templates/opencode-mcp-config.md), or [Antigravity MCP config](./templates/antigravity-mcp-config.md) only after n8n is running and MCP is enabled inside n8n.

Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, backups, or live n8n imports/exports.

## Primary Route

| Need | Open |
| --- | --- |
| Local Docker Desktop setup, menu, updates, tunnel, URLs, MCP, platform setup, troubleshooting, and daily commands | [1. Local Setup](./1.%20local%20setup.md) |

## Appendices And References

These pages are retained as focused appendices. They are not equal start paths for local setup.

| Need | Open |
| --- | --- |
| Focused update notes for local, VPS, and npm installs | [2. Upgrading](./2.%20upgrading.md) |
| Focused local ngrok tunnel behavior | [3. Tunneling Guide](./3.%20tunneling%20guide.md) |
| Compose template details | [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) |
| Always-on public n8n, Hostinger, VPS, and Coolify | [4. VPS Hosting](./4.%20vps%20hosting.md) |
| Claude Code platform details | [5. Claude Code Integration](./5.%20extra%20-%20claude%20code%20integration.md) |
| OpenCode platform details | [6. OpenCode Integration](./6.%20extra%20-%20opencode%20integration.md) |
| Antigravity platform details | [7. Antigravity Integration](./7.%20extra%20-%20antigravity%20integration.md) |

## Recommended Example Folder

The local stack folder can live anywhere. For this guide, use the Desktop example path:

```text
%USERPROFILE%\Desktop\n8n-local
```

Run this in PowerShell from any folder:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Desktop\n8n-local"
Set-Location "$env:USERPROFILE\Desktop\n8n-local"
```

## Blessed Local Stack

The default stack is:

- `n8n`: the local n8n application.
- `postgres`: n8n's internal runtime database.
- `ngrok`: the only supported local public tunnel in this guide.
- `postgres_data` and `n8n_data`: persistent local Docker volumes.
- `.env`: local-only runtime configuration copied from placeholder-only [.env.example](./templates/local-stack/.env.example).
- [n8n-local.cmd](./templates/local-stack/n8n-local.cmd): the local launcher for guided start, update, logs, status, browser, and backup actions.
- [n8n-local-menu.ps1](./templates/local-stack/scripts/n8n-local-menu.ps1): the PowerShell menu behind the launcher.

## Blessed Local Launcher

Run this in PowerShell from the local stack folder:

```powershell
.\n8n-local.cmd
```

The launcher opens a PowerShell menu that checks required files, checks whether Docker appears available, offers update checks, starts the stack, shows status, opens logs, opens n8n, opens the ngrok inspector, and can back up Postgres.

The stack does not silently auto-update. The update check compares local image tag IDs before and after pull. It may pull newer images into the local Docker cache, but it does not restart or recreate services until the user chooses an update option.

Docker Desktop can still be used to view containers and logs. Docker Desktop Play bypasses the menu and update checks, so start through `n8n-local.cmd` if you want guided checks on launch.

## Why Postgres Is Included

SQLite is simpler for throwaway local testing. This toolkit chooses Postgres by default because it optimises for production-ready templates:

- The app plus database shape is closer to real deployments.
- Future queue-mode scaling is easier to explain because queue mode also uses Postgres.
- Local development has better parity with production templates.

The local Postgres service is only n8n's internal runtime database. It is not Vercel, it is not Supabase, and it must not be wired to the user's app database.

## Tunnel Scope

ngrok is the only supported local tunnel path in this guide. It exposes the full local n8n UI, API, webhook, and MCP surface reachable through the tunnel URL, not only webhooks.

Use local-only n8n first to create the owner account, then start the public tunnel only when an outside service needs to call local n8n.

Do not install a manual Windows ngrok binary for this guide. The Compose stack runs ngrok as a service.

## Advanced Queue Mode

The Fast Path does not include Redis or workers.

Queue mode is a future production scaling shape:

- n8n main serves the UI, API, webhooks, and scheduler.
- Redis queues execution jobs.
- n8n worker containers run executions.
- Postgres stores durable workflow, credential, user, and execution state.

Use queue mode later when you need worker-based production scaling. Do not add Redis or workers to the default local Fast Path.

## Agent Rules And Adapters

| File or folder | Use |
| --- | --- |
| [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md) | Generic Codex or OpenCode rules template. |
| [CLAUDE.template.md](../../../development/ai-coding-agent-rules/_main/CLAUDE.template.md) | Generic Claude Code rules template. |
| [GEMINI.template.md](../../../development/ai-coding-agent-rules/_main/GEMINI.template.md) | Generic Gemini or Antigravity rules template. |
| [n8n Agent Rules](../../../../skills/n8n-agent-rules/) | Full n8n workflow, MCP routing, live-instance, and manual-configuration rules. |

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

The local setup project references the n8n rules; it does not own them. The canonical source is [_projects/development/ai-coding-agent-rules/](../../../development/ai-coding-agent-rules/).

## MCP Config Templates

| Template | Use |
| --- | --- |
| [Codex MCP config](./templates/codex-mcp-config.md) | Connect Codex to `n8n_docs` and `n8n_live`. |
| [Claude MCP config](./templates/claude-mcp-config.md) | Connect Claude Code to `n8n_docs` and `n8n_live`. |
| [OpenCode MCP config](./templates/opencode-mcp-config.md) | Connect OpenCode to `n8n_docs` and approval-gated `n8n_live`. |
| [Antigravity MCP config](./templates/antigravity-mcp-config.md) | Connect Antigravity to `n8n_docs` and `n8n_live`. |

Keep live tokens in user environment variables, not repo files.

## Safety Notes

- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not treat ngrok as production hosting.
- Do not expose the n8n container directly to the LAN or internet.
- Do not paste real API tokens, webhook secrets, passwords, encryption keys, or MCP tokens into repo files.
- Do not edit Docker volume names unless you understand that this changes where local n8n data lives.
- Do not remove the `n8n_data` or `postgres_data` Docker volumes unless you intentionally want to delete local runtime data.
