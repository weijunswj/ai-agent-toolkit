<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Claude Code n8n Local Pack

Collects [AI Coding Agent Rules](../../../ai-coding-agent-rules/), [n8n Agent Rules](../../../n8n-agent-rules/), the optional [Claude n8n adapter](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md), [local Docker Compose stack templates](../../templates/local-stack/), [Claude MCP config](../../templates/mcp-configs/claude-mcp-config.md), and local n8n setup guides.

Review [pack.json](pack.json) before use.

Create or merge [repo-local/AGENTS.managed.template.md](../../../ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) into the target repo root as `AGENTS.md`, then add [repo-local/CLAUDE.shim.template.md](../../../ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md) as `CLAUDE.md`. Install or load [n8n Agent Rules](../../../n8n-agent-rules/), and optionally merge [CLAUDE.n8n-brief.template.md](../../../n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md) into the same file. If the target repo already has instruction files, do not overwrite them; produce a merge/diff plan. Run the adapter installer with `--dry-run` first and only use `--write` after explicit current-turn approval.

For local runtime, copy the local stack templates outside this repo, copy [.env.example](../../templates/local-stack/.env.example) to `.env`, fill placeholders locally, then start through [n8n-local.cmd](../../templates/local-stack/n8n-local.cmd). Never commit `.env`, credentials, runtime payloads, `.n8n-local/`, `.tmp/`, or live imports/exports.
