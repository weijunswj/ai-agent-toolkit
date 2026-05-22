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

This folder contains the generated n8n-specific add-on rule template for AI coding agents.

The files in this skill folder are intentionally inert templates. They use `.template.md` filenames so they are not mistaken for active nested repo instructions while the skill is copied or inspected.

Generated file:

- `n8n-mcp-rules.template.md`

Install it only after generic AI coding agent rules from `skills/ai-coding-agent-rules` are installed or merged in a target repo:

- Merge `n8n-mcp-rules.template.md` into the target repo root `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

Generic AI coding agent rule templates live in `skills/ai-coding-agent-rules/`.

Source partials are declared in the local n8n setup project manifest:

- [_projects/n8n/local-setup/_main/_partials/n8n-mcp-rules.md](/_projects/n8n/local-setup/_main/_partials/n8n-mcp-rules.md)

The assembled source-side add-on template lives under [_projects/n8n/local-setup/_main/agent-rules/](/_projects/n8n/local-setup/_main/agent-rules/).

Regenerate with:

```powershell
npm run build:agent-rules
node repo/scripts/sync-toolkit-projects.cjs --write
```

Generated outputs must stay deterministic. Do not edit them directly.

Generated outputs are normal Markdown files. They are not wrapped in a single giant code fence, because the n8n rules contain their own fenced examples.

The generated-template CI workflow is check-only. Future narrow writeback can be added separately if it stages only the expected generated template files and preserves the normal `npm run validate:all` merge gate.
