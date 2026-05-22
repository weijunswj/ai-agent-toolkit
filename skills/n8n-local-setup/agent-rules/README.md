<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/agent-rules/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Agent Rule Templates

This folder contains generated n8n-specific rule templates for AI coding agents.

The files in this skill folder are intentionally inert templates. They use `.template.md` filenames so they are not mistaken for active nested repo instructions while the skill is copied or inspected.

Generated add-on file:

- `n8n-mcp-rules.template.md`

`n8n-mcp-rules.template.md` contains only n8n MCP/workflow rules. Install it only after generic AI coding agent rules from `skills/ai-coding-agent-rules` are installed or merged in a target repo:

- Merge `n8n-mcp-rules.template.md` into the target repo root `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

Published one-shot full n8n convenience templates are also available for target environments that have this toolkit's `skills/` folders installed or copied:

- `AGENTS.n8n-full.template.md`
- `CLAUDE.n8n-full.template.md`
- `GEMINI.n8n-full.template.md`

These combine the generic baseline, toolkit skill-routing, and n8n MCP/workflow rules. They are equivalent to installing the matching baseline template, merging `TOOLKIT-SKILL-ROUTING.template.md`, then merging `n8n-mcp-rules.template.md`. They are skill-side conveniences, not source-side `_main` canonical docs.

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

Generic AI coding agent rule templates live in `skills/ai-coding-agent-rules/`. Those baseline templates stay generic; `TOOLKIT-SKILL-ROUTING.template.md` remains the optional toolkit skill-routing add-on.

Source partials are declared in the local n8n setup project manifest:

- [_projects/n8n/local-setup/_main/_partials/n8n-mcp-rules.md](/_projects/n8n/local-setup/_main/_partials/n8n-mcp-rules.md)

The assembled source-side n8n add-on lives at [_projects/n8n/local-setup/_main/agent-rules/n8n-mcp-rules.template.md](/_projects/n8n/local-setup/_main/agent-rules/n8n-mcp-rules.template.md). Source-side n8n stays n8n-only and does not own generic baseline or combined convenience templates.

Regenerate with:

```powershell
npm run build:agent-rules
node repo/scripts/sync-toolkit-projects.cjs --write
```

Generated outputs must stay deterministic. Do not edit them directly.

Generated outputs use one 8-backtick fenced payload so the n8n rules can safely contain their own fenced examples.

The generated-template CI workflow is check-only. Future narrow writeback can be added separately if it stages only the expected generated template files and preserves the normal `npm run validate:all` merge gate.
