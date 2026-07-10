<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/packs/claude-code-n8n-local/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Code n8n Local Pack

Pack inventory for Claude Code agents working with local n8n material. It points to canonical rules, references, templates, and metadata without duplicating the full runtime guide.

Review [pack.json](pack.json) before copying files.

## Contains

- [AI Coding Agent Rules](../../../ai-coding-agent-rules/), the repo-local `AGENTS.md` template, and the Claude Code `CLAUDE.md` shim.
- [n8n Agent Rules](../../../n8n-agent-rules/) and the optional [Claude n8n adapter](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md).
- [Local stack templates](../../templates/.n8n-local/), [production Cloudflare stack templates](../../templates/.n8n-production-cloudflare/), [production server backup templates](../../templates/production-server-backups/), Claude Code [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup references, and the local/production n8n guides.

## Review Notes

- If the target repo already has instruction files, produce a merge/diff plan first and do not overwrite them.
- Preview adapter changes before writing them, and use `--write` only after explicit current-turn approval.
- Use [official n8n Skills](https://github.com/n8n-io/skills) and n8n Agent Rules before workflow, import/export, credential, execution, repo/live sync, or live-instance work.
- Claude Code [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup is secondary and not part of the beginner local path.
- Dev webhook testing remains on the local ngrok permanent/reserved URL path. Production self-hosting from a local/CGNAT machine uses the separate Cloudflare Tunnel production guide and stack.
- Local launcher backup and recovery options are local/dev database restore only, not production restore or the regular workflow JSON flow.
- Hostinger/Coolify and company-server backups use the Linux production server backup template with n8n CLI exports, database backup where applicable, manifest/log/restore notes, retention cleanup, and systemd timer or cron scheduling.
- Never commit `.env`, credentials, tunnel tokens, real domains, account IDs, DNS values, IPs, backups, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
