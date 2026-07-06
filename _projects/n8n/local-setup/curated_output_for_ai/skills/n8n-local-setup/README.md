<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe n8n environment setup: local dev, production Cloudflare Tunnel, Hostinger/Coolify, production backups, stack templates, [official n8n Skills](https://github.com/n8n-io/skills), and instance-level MCP references.

## Start Here

| Need | Open |
| --- | --- |
| Beginner local setup guide | [references/n8n/local-setup.md](references/n8n/local-setup.md) |
| Hostinger Coolify VPS n8n guide | [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md) |
| Production Cloudflare Tunnel self-hosting guide | [references/n8n/production-cloudflare-tunnel.md](references/n8n/production-cloudflare-tunnel.md) |
| n8n reference index | [references/n8n/](references/n8n/) |
| [Official n8n Skills](https://github.com/n8n-io/skills) and agent routing | [references/ai-agent-platforms/](references/ai-agent-platforms/) |
| Local stack templates | [templates/local-stack/](templates/local-stack/) |
| Production Cloudflare stack templates | [templates/production-cloudflare-stack/](templates/production-cloudflare-stack/) |
| Production server backup templates | [templates/production-server-backups/](templates/production-server-backups/) |
| Official MCP config templates | [templates/mcp-configs/](templates/mcp-configs/) |

Normal skill use does not require `_projects/`. Dev webhook testing stays on the local ngrok path. Production uses either the Cloudflare stack or the Linux server backup template with systemd/cron scheduling.

## Agent Rules And Adapters

Load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, import/export, credential, execution, repo/live sync, or live-instance work. A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md).

Before repo file edits, automatically check repo-local agent instructions. If they are missing, unmanaged, stale, or structurally broken, bootstrap/repair them first.

## Safety Notes

- Keep tokens, API keys, webhook secrets, tunnel tokens, real domains, DNS values, backups, and `.env` values out of repo files.
- Keep workflow exports, credential exports, database dumps, manifests, backup logs, and restore notes private.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- Do not run live Cloudflare, DNS, tunnel, Docker, credential, workflow activation, import/export, or production actions without explicit current-turn confirmation naming the target and operation.
- For live n8n or production work, require explicit current-turn confirmation and identify the target instance first.
