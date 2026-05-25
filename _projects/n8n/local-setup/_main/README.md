# Codex + n8n Local Setup

This repository is a beginner-friendly Windows guide for running local `n8n` in Docker and connecting it to Codex through MCP.

It also includes optional local tunnelling, a Docker Compose + ngrok path, VPS hosting notes, Claude Code integration, OpenCode integration, Antigravity integration, reusable settings templates, and Windows helper scripts for local webhook testing and template maintenance.

---

## Start here

Use this table to choose the right path. Do not overthink it.

| Situation | Use this |
| --- | --- |
| I want local n8n + Codex on Windows | [1. Local Setup](./1.%20local%20setup.md) |
| I want to refresh/update my local Docker n8n | [2. Upgrading](./2.%20upgrading.md) |
| I need Stripe, Telegram, GitHub, Meta, or another external service to call my local n8n | [3. Tunneling Guide](./3.%20tunneling%20guide.md) |
| I want local n8n managed by Docker Compose while still using ngrok | [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) |
| I want a real always-on public n8n | [4. VPS Hosting](./4.%20vps%20hosting.md) |
| I already have Codex working and want Claude Code too | [EXTRA: Claude Code Integration](./5.%20extra%20-%20claude%20code%20integration.md) |
| I already have Codex working and want OpenCode too | [EXTRA: OpenCode Integration](./6.%20extra%20-%20opencode%20integration.md) |
| I already have Codex working and want Antigravity too | [EXTRA: Antigravity Integration](./7.%20extra%20-%20antigravity%20integration.md) |

---

## Local vs tunnel vs Compose vs VPS

| Setup | Public URL | Permanent | Use scripts from this repo? |
| --- | --- | --- | --- |
| Local Windows Docker | No | Yes, on your own PC | No script needed |
| Local Windows Docker + ngrok | Yes, temporary | No | Yes, optional ngrok script |
| Local Docker Compose + ngrok | Yes, temporary | No | Yes, use the Compose wrapper script from the guide |
| VPS / production | Yes | Yes | No |

Important:

* The local n8n scripts in this repo are for local Windows development only.
* Do not use local n8n scripts for VPS, production, Hostinger, or Coolify deployments.
* Use the normal ngrok script if you want the simplest local tunnel path.
* Use the Compose + ngrok guide if you want cleaner Docker management while still using a temporary local tunnel.
* VPS / production upgrades should use Docker Compose or the provider UI.

---

## Recommended beginner flow

1. Follow [1. Local Setup](./1.%20local%20setup.md).
2. Install or copy generic AI coding agent rules from the source-side generic templates, such as [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md), into the target repo root as `AGENTS.md`.
3. Install or load the `n8n-agent-rules` skill for the full n8n operating contract.
4. Optionally merge a brief adapter from `skills/n8n-agent-rules/adapters/` into the active rules file. Adapters point to the skill; they do not duplicate the full ruleset.
5. Copy the Codex MCP config from [templates/codex-mcp-config.md](./templates/codex-mcp-config.md).
6. Restart Codex.
7. Run the smoke tests in the local setup guide.
8. Add Claude Code, OpenCode, or Antigravity only after the Codex setup works.
9. Only move to tunnelling if an outside service needs to call your local n8n.
10. If the normal ngrok script feels limiting and you want a cleaner Docker base, move to [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md).
11. Only move to VPS hosting when you need real always-on public n8n.

---

## Copy-paste setup paths

| Tool | Copy-paste path |
| --- | --- |
| Codex | Install generic rules from [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md), install or load `skills/n8n-agent-rules`, optionally merge `AGENTS.n8n-brief.template.md`, then copy [templates/codex-mcp-config.md](./templates/codex-mcp-config.md). |
| Claude Code | Install generic rules from [CLAUDE.template.md](../../../development/ai-coding-agent-rules/_main/CLAUDE.template.md), install or load `skills/n8n-agent-rules`, optionally merge `CLAUDE.n8n-brief.template.md`, then run the commands from [templates/claude-mcp-config.md](./templates/claude-mcp-config.md). |
| OpenCode | Install generic rules from [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md), install or load `skills/n8n-agent-rules`, optionally merge `AGENTS.n8n-brief.template.md`, then copy [templates/opencode-mcp-config.md](./templates/opencode-mcp-config.md). |
| Antigravity | Install generic rules from [GEMINI.template.md](../../../development/ai-coding-agent-rules/_main/GEMINI.template.md), install or load `skills/n8n-agent-rules`, optionally merge `GEMINI.n8n-brief.template.md`, then copy [templates/antigravity-mcp-config.md](./templates/antigravity-mcp-config.md). |

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

---

## Settings templates

Use these linked templates instead of copying giant config walls from the guide.

Generated templates should not be edited directly; edit the source partials first, then regenerate the generated templates.

| Source file | Edit when |
| --- | --- |
| [n8n agent rules](../../../development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules.md) | You want to change n8n workflow, MCP routing, live-instance, or manual-configuration rules. |
| [Codex MCP config](./templates/codex-mcp-config.md) | You want to change Codex MCP server config. This file is not generated from partials. |
| [Antigravity MCP config](./templates/antigravity-mcp-config.md) | You want to change Antigravity MCP server config. This file is not generated from partials. |

Generic AI coding agent execution rules and the full n8n operating rules are owned by [_projects/development/ai-coding-agent-rules/](../../../development/ai-coding-agent-rules/).

The local setup project does not own the full n8n ruleset. It references the generated `n8n-agent-rules` skill and its generated local reference copy for portability.

To regenerate locally from the toolkit repo root, run `npm run build:agent-rules`, then `node repo/scripts/sync-toolkit-projects.cjs --write`.

GitHub Actions is also set up to regenerate rule templates and check the expected generated files on PR branches when source partials or the template generator change. It is check-only.
| Template | Use when |
| --- | --- |
| [Codex MCP config](./templates/codex-mcp-config.md) | You want Codex to connect to `n8n_docs` and `n8n_live`. |
| [Claude MCP config](./templates/claude-mcp-config.md) | You want Claude Code to connect to `n8n_docs` and `n8n_live`. |
| [OpenCode MCP config](./templates/opencode-mcp-config.md) | You want OpenCode to connect to `n8n_docs` and approval-gated `n8n_live`. |
| [Antigravity MCP config](./templates/antigravity-mcp-config.md) | You want Antigravity to connect to `n8n_docs` and `n8n_live`. |
| `skills/n8n-agent-rules/adapters/*.n8n-brief.template.md` | You want a brief optional active-instruction snippet that points to `n8n-agent-rules` without copying the full rules. |

## Scripts

| Script | Use when |
| --- | --- |
| [start-n8n-ngrok.bat](./scripts/windows/start-n8n-ngrok.bat) | You want the simplest local n8n with a temporary public ngrok URL for webhook testing. |
| `start-n8n-compose-ngrok.bat` from [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) | You want n8n managed by Docker Compose while still auto-reading the ngrok URL. |
| `npm run build:agent-rules` | You changed generic agent-rule partials and want to regenerate inert generic templates. |

The normal ngrok script:

* Starts ngrok.
* Reads the public HTTPS tunnel URL.
* Pulls the latest n8n stable Docker image.
* Recreates the local n8n Docker container.
* Sets `WEBHOOK_URL` and `N8N_PROXY_HOPS=1`.

The Compose + ngrok guide keeps the same tunnel behaviour, but uses Docker Compose for the n8n container instead of a long `docker run` command.

There is intentionally no separate local upgrade script. The local PowerShell blocks, the normal ngrok script, and the Compose wrapper flow all pull the latest image before recreating the container.

---

## What not to do

* Do not use tunnelling as permanent hosting.
* Do not use local Windows scripts on VPS or production.
* Do not paste real API tokens into repo files.
* Do not store n8n tokens in workflow nodes or sticky notes.
* Do not edit Docker volume names unless you understand that this changes where your n8n data lives.
* Do not remove the existing `n8n_data` Docker volume unless you intentionally want to delete your local n8n data.

---

## Fast route

If you are lazy and just want the safest normal path:

1. Open [1. Local Setup](./1.%20local%20setup.md).
2. Install generic rules from [AGENTS.template.md](../../../development/ai-coding-agent-rules/_main/AGENTS.template.md).
3. Install or load `skills/n8n-agent-rules`.
4. Use [templates/codex-mcp-config.md](./templates/codex-mcp-config.md).
5. Ignore Claude Code, OpenCode, and Antigravity until Codex works.
6. Ignore tunnelling until you actually need external webhooks.
7. Use the normal ngrok script first if you need external webhook testing.
8. Move to [3a. Docker Compose + ngrok](./3a.%20docker%20compose%20%2B%20ngrok.md) only when you want cleaner Docker management.
9. Ignore VPS until you need always-on public hosting.
