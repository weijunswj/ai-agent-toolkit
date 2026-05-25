# Codex + n8n Local Setup

Beginner-friendly Windows guide for running local `n8n` in Docker and connecting it to Codex through MCP.

## Start Here

| Need | Open |
| --- | --- |
| Local n8n + Codex on Windows | [1. Local Setup](./1.%20local%20setup.md) |
| Refresh or update local Docker n8n | [2. Upgrading](./2.%20upgrading.md) |
| External services need to call local n8n | [3. Tunneling Guide](./3.%20tunneling%20guide.md) |
| Docker Compose plus a temporary ngrok URL | [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) |
| Always-on public n8n | [4. VPS Hosting](./4.%20vps%20hosting.md) |
| Claude Code setup | [5. Claude Code Integration](./5.%20extra%20-%20claude%20code%20integration.md) |
| OpenCode setup | [6. OpenCode Integration](./6.%20extra%20-%20opencode%20integration.md) |
| Antigravity setup | [7. Antigravity Integration](./7.%20extra%20-%20antigravity%20integration.md) |

## Beginner Path

1. Follow [1. Local Setup](./1.%20local%20setup.md).
2. Add generic agent rules from [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md) to the target repo as `AGENTS.md`.
3. Install or load the [n8n-agent-rules skill](../../../../skills/n8n-agent-rules/).
4. Copy the [Codex MCP config](./templates/codex-mcp-config.md).
5. Restart Codex and run the smoke tests from the setup guide.
6. Add Claude Code, OpenCode, Antigravity, tunnelling, Compose, or VPS only when you need them.

## Setup Choices

| Setup | Public URL | Persistent | Notes |
| --- | --- | --- | --- |
| Local Windows Docker | No | Yes, on your PC | Best first path. |
| Local Windows Docker + ngrok | Temporary | No | Simplest webhook-testing tunnel. |
| Local Docker Compose + ngrok | Temporary | No | Cleaner Docker management with the same tunnel idea. |
| VPS / production | Yes | Yes | Use provider or Compose operations, not local Windows scripts. |

## Agent Rules And Adapters

| File or folder | Use |
| --- | --- |
| [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md) | Generic Codex or OpenCode rules template. |
| [CLAUDE.template.md](../../../development/ai-coding-agent-rules/_main/CLAUDE.template.md) | Generic Claude Code rules template. |
| [GEMINI.template.md](../../../development/ai-coding-agent-rules/_main/GEMINI.template.md) | Generic Gemini or Antigravity rules template. |
| [n8n-agent-rules skill](../../../../skills/n8n-agent-rules/) | Full n8n workflow, MCP routing, live-instance, and manual-configuration rules. |
| [AGENTS n8n adapter](../../../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md) | Optional Codex or OpenCode active-instruction pointer. |
| [CLAUDE n8n adapter](../../../../skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md) | Optional Claude Code active-instruction pointer. |
| [GEMINI n8n adapter](../../../../skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md) | Optional Gemini or Antigravity active-instruction pointer. |

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

## Scripts

| Script | Use |
| --- | --- |
| [start-n8n-ngrok.bat](./scripts/windows/start-n8n-ngrok.bat) | Start local n8n with a temporary ngrok URL for webhook testing. |
| `start-n8n-compose-ngrok.bat` from [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) | Run the Compose-based local tunnel flow from that guide. |
| `npm run build:agent-rules` | Regenerate generic agent-rule templates after source partial changes. |

The normal ngrok script starts ngrok, reads the HTTPS tunnel URL, pulls the latest stable n8n Docker image, recreates the local container, and sets `WEBHOOK_URL` plus `N8N_PROXY_HOPS=1`.

There is no separate local upgrade script. The local setup commands, normal ngrok script, and Compose wrapper flow pull the latest image before recreating the container.

## Safety Notes

- Do not use tunnelling as permanent hosting.
- Do not use local Windows scripts on VPS or production.
- Do not paste real API tokens into repo files.
- Do not store n8n tokens in workflow nodes or sticky notes.
- Do not edit Docker volume names unless you understand that this changes where your n8n data lives.
- Do not remove the existing `n8n_data` Docker volume unless you intentionally want to delete local n8n data.
