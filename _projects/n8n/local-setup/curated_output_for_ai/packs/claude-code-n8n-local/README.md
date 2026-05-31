<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Code n8n Local Pack

Collects [AI Coding Agent Rules](../../../ai-coding-agent-rules/), [n8n Agent Rules](../../../n8n-agent-rules/), the optional [Claude n8n adapter](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md), [local Docker Compose stack templates](../../templates/local-stack/), optional Claude Code MCP feature config, and local/Hostinger n8n setup guides.

Optional AI-coding-agent MCP config is secondary and not part of the beginner local setup path.

Review [pack.json](pack.json) before use.

## Instruction files

1. Create or merge [repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) into the target repo root as `AGENTS.md`.
2. Add [repo-local/CLAUDE.shim.template.md](../../../ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md) as `CLAUDE.md`.
3. Install or load [n8n Agent Rules](../../../n8n-agent-rules/).
4. Optionally merge [CLAUDE.n8n-brief.template.md](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md) into the same file.

If the target repo already has instruction files, do not overwrite them; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.

## Local runtime

1. Copy everything inside [templates/local-stack/](../../templates/local-stack/) into `%USERPROFILE%\.n8n-local` or another local folder outside this repo.
2. Copy [.env.example](../../templates/local-stack/.env.example) to a new file named `.env`.
3. Fill placeholders locally in `.env`; do not edit `.env.example`.
4. Start through [_n8n-local.cmd](../../templates/local-stack/_n8n-local.cmd).

Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
