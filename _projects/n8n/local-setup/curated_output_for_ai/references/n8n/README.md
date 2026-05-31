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
| [local-setup.md](local-setup.md) | Running the local Docker Desktop setup with n8n, Postgres, the `_n8n-local.cmd` menu, updates, Compose ngrok public access, troubleshooting, and daily commands. |
| [hostinger-vps.md](hostinger-vps.md) | Moving from local testing to always-on Hostinger VPS hosting with domain, backup, queue mode, update, and safety guidance. |

## Skills-First Note

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional AI-coding-agent MCP feature references are secondary and not part of the beginner local setup flow.
