<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/references/n8n/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup References

These references are local to the copyable skill folder. Use them for normal execution instead of requiring access to `_projects/`.

## Main Pages

| Guide | Use when |
| --- | --- |
| [local-setup.md](local-setup.md) | Running the local Docker Desktop setup with n8n, Postgres, the `_n8n-local.cmd` menu, updates, local backup/restore recovery, Compose ngrok public access, troubleshooting, and daily commands. |
| [hostinger-vps.md](hostinger-vps.md) | Moving from local testing to always-on Hostinger Coolify VPS hosting, after Coolify exists, with n8n deployment, domain/routing, private Postgres, backup, update, and safety guidance. |
| [production-cloudflare-tunnel.md](production-cloudflare-tunnel.md) | Production self-hosting from a local/CGNAT machine through Cloudflare Tunnel, with a separate production stack, private Postgres, no public direct n8n port, backups, preflight, and safety guidance. |

## Skills-First Note

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Dev webhook testing remains on ngrok permanent/reserved URL mode. Production self-hosting from local/CGNAT machines uses the separate Cloudflare Tunnel production guide and stack. Hostinger/Coolify and company-server backups use the Linux production server backup templates under `templates/production-server-backups/`. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are secondary and not part of the beginner local setup flow.
