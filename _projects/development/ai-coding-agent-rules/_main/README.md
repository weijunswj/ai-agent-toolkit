# AI Coding Agent Rule Templates

This source folder owns the human/manual global agent instruction templates and reusable partials for the AI Coding Agent Rules project.

## Templates

- [AGENTS.template.md](AGENTS.template.md), [CLAUDE.template.md](CLAUDE.template.md), and [GEMINI.template.md](GEMINI.template.md) are human/manual global setup reference templates generated from the reusable execution prompt partial.
- Repo-local automatic bootstrap templates are reviewed skill-facing material under [../curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/](../curated_output_for_ai/skills/ai-coding-agent-rules/repo-local/) and publish to [skills/ai-coding-agent-rules/](../../../../skills/ai-coding-agent-rules/).
- Optional n8n adapters publish under [skills/n8n-agent-rules/adapters/](../../../../skills/n8n-agent-rules/adapters/) after sync. They point to the n8n skill instead of duplicating the full ruleset.
- Do not overwrite existing active instruction files.
- After changing root instruction template sources, run `node repo/scripts/sync-agent-instruction-shims.cjs --write` to refresh root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`, then run `node repo/scripts/sync-toolkit-projects.cjs --write` to publish skill copies.

## Source Partials

- [_partials/ai-coding-agent-execution.md](_partials/ai-coding-agent-execution.md) is the one canonical reusable toolkit prompt source.
- [_partials/n8n-agent-rules-adapter.md](_partials/n8n-agent-rules-adapter.md) is the compact fail-closed n8n adapter source used by root and repo-local managed `AGENTS.md` surfaces.
- [_partials/toolkit-skill-routing.md](_partials/toolkit-skill-routing.md) is the toolkit skill-routing source partial.
- [_partials/n8n-agent-rules.md](_partials/n8n-agent-rules.md) is the canonical full n8n operating ruleset source.

## n8n Agent Rules

For n8n work, install or load:

[skills/n8n-agent-rules/](../../../../skills/n8n-agent-rules/)

Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
