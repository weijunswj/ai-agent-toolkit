# AI Coding Agent Rule Templates

This source folder owns generic execution-first AI coding agent rule templates.

## Templates

- `AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` are generic baseline templates.
- `TOOLKIT-SKILL-ROUTING.template.md` is optional. Use it only when the target environment has this toolkit's `skills/` folders installed or copied.
- Do not use `TOOLKIT-SKILL-ROUTING.template.md` as a standalone replacement for the generic baseline.
- Merge optional add-ons under the generic baseline in the same active instruction file.
- Do not overwrite existing active instruction files.

## Source Partials

- `_partials/ai-coding-agent-execution.md` generates the generic baseline templates.
- `_partials/toolkit-skill-routing.md` generates only `TOOLKIT-SKILL-ROUTING.template.md`.

## n8n Add-On

For n8n work, install a generic baseline first, then merge the n8n add-on from:

```text
skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md
```
