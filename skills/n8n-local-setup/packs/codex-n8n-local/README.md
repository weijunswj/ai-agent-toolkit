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

Collects [AI Coding Agent Rules](../../../ai-coding-agent-rules/), [n8n Agent Rules](../../../n8n-agent-rules/), the optional [Codex n8n adapter](../../../n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md), [local Docker Compose stack templates](../../templates/local-stack/), [Codex MCP config](../../templates/mcp-configs/codex-mcp-config.md), and local n8n setup guides.

Review [pack.json](pack.json) before use.

Copy or merge [AGENTS.template.md](../../../ai-coding-agent-rules/AGENTS.template.md) into the target repo root as `AGENTS.md`, install or load [n8n Agent Rules](../../../n8n-agent-rules/), and optionally merge [AGENTS.n8n-brief.template.md](../../../n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md) into the same file. If the target repo already has `AGENTS.md`, do not overwrite it; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.

For local runtime, copy [.env.example](../../templates/local-stack/.env.example) to `.env` outside this repo, fill placeholders locally, and never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
