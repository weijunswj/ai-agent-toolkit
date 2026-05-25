# AI Coding Agent Rule Templates

This source folder owns slim generic execution-first AI coding agent rule templates and the canonical n8n agent rules source.

## Templates

- `AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` are generic baseline templates.
- Default generic templates stay compact and do not include full n8n rules or full skill-routing tables.
- Optional n8n adapters live under `skills/n8n-agent-rules/adapters/` after sync. They point to the n8n skill instead of duplicating the full ruleset.
- Do not overwrite existing active instruction files.

## Source Partials

- `_partials/ai-coding-agent-execution.md` generates the generic baseline templates.
- `_partials/toolkit-skill-routing.md` is the toolkit skill-routing source partial.
- `_partials/n8n-agent-rules.md` is the canonical full n8n operating ruleset source.

## n8n Agent Rules

For n8n work, install or load:

```text
skills/n8n-agent-rules/
```

Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
