<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Codex n8n Local Pack

Pack inventory for Codex agents working with local n8n material. It points to canonical rules, references, templates, and metadata without duplicating the full runtime guide.

Review [pack.json](pack.json) before copying files.

## Contains

- [AI Coding Agent Rules](../../../ai-coding-agent-rules/) and the Codex repo-local `AGENTS.md` template.
- [n8n Agent Rules](../../../n8n-agent-rules/) and the optional [Codex n8n adapter](../../../n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md).
- [Local stack templates](../../templates/local-stack/), Codex [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup references, and the local/Hostinger Coolify n8n guides.

## Review Notes

- If the target repo already has `AGENTS.md`, produce a merge/diff plan first and do not overwrite it.
- Use [official n8n Skills](https://github.com/n8n-io/skills) and n8n Agent Rules before workflow, import/export, credential, execution, repo/live sync, or live-instance work.
- Codex [official n8n Skills](https://github.com/n8n-io/skills) plus MCP setup is secondary and not part of the beginner local path.
- Local launcher backup and recovery options are local/dev database restore only, not production restore or the regular workflow JSON flow.
- Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
