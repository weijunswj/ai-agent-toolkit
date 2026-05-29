# Codex + n8n Local Setup

Beginner-friendly local n8n setup source index.

Use this project when you want local n8n on Windows with Docker Compose, Postgres, ngrok, the `n8n-local.cmd` menu, MCP setup, and AI-agent platform references.

## Start Here

| Need | Open |
| --- | --- |
| Full beginner setup | [1. Local Setup](./1.%20local%20setup.md) |
| Always-on public hosting | [4. VPS Hosting](./4.%20vps%20hosting.md) |
| Source template folder | [templates/local-stack/](./templates/local-stack/) |

## References

These pages are secondary references. They are not equal start paths for local setup.

| Need | Open |
| --- | --- |
| Focused update notes | [2. Upgrading](./2.%20upgrading.md) |
| Hostinger domain and tunnel notes | [3. Hostinger Domain And Tunnel Notes](./3.%20tunneling%20guide.md) |
| Compose template details | [3a. Compose Template Reference](./3a.%20docker%20compose%20%2B%20ngrok.md) |
| Claude Code platform details | [5. Claude Code Integration](./5.%20extra%20-%20claude%20code%20integration.md) |
| OpenCode platform details | [6. OpenCode Integration](./6.%20extra%20-%20opencode%20integration.md) |
| Antigravity platform details | [7. Antigravity Integration](./7.%20extra%20-%20antigravity%20integration.md) |

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

| Need | Open |
| --- | --- |
| Generic AI coding-agent rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
| Full n8n workflow and live-action rules | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |
| Local stack templates | [templates/local-stack/](./templates/local-stack/) |
| MCP config templates | [templates/](./templates/) |

## Safety Notes

- Do not run live n8n import/export, activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not paste real API tokens, webhook secrets, passwords, encryption keys, or MCP tokens into repo files.
- Do not save `.env`, `.n8n-local/`, `.tmp/`, backups, credentials, runtime payloads, or live n8n imports/exports into GitHub.
- Do not remove Docker volumes unless you intentionally want to delete local runtime data.
