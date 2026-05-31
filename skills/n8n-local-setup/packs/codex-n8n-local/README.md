<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Codex n8n Local Pack

Collects [AI Coding Agent Rules](../../../ai-coding-agent-rules/), [n8n Agent Rules](../../../n8n-agent-rules/), the optional [Codex n8n adapter](../../../n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md), [local Docker Compose stack templates](../../templates/local-stack/), optional Codex MCP feature config, and local/Hostinger n8n setup guides.

Optional AI-coding-agent MCP config is secondary and not part of the beginner local setup path.

Review [pack.json](pack.json) before use.

## Instruction files

1. Copy or merge [repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) into the target repo root as `AGENTS.md`.
2. Install or load [n8n Agent Rules](../../../n8n-agent-rules/).
3. Optionally merge [AGENTS.n8n-brief.template.md](../../../n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md) into the same file.

If the target repo already has `AGENTS.md`, do not overwrite it; produce a merge/diff plan first. Only merge/append the adapter rules after explicit current-turn approval.

## Local runtime

1. Copy everything inside [templates/local-stack/](../../templates/local-stack/) into `%USERPROFILE%\.n8n-local` or another local folder outside this repo.
2. Copy [.env.example](../../templates/local-stack/.env.example) to a new file named `.env`.
3. Fill placeholders locally in `.env`; do not edit `.env.example`.
4. Start through [_n8n-local.cmd](../../templates/local-stack/_n8n-local.cmd).

Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
