<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/templates/agent-rules/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Agent Rule Templates

This folder contains generated copy-paste rule templates for AI coding agents.

The files in this skill folder are intentionally inert templates. They use `.template.md` filenames so they are not mistaken for active nested repo instructions while the skill is copied or inspected.

Generated files:

- `AGENTS.template.md`
- `CLAUDE.template.md`
- `GEMINI.template.md`

Install them only when the user explicitly wants those agent rules in a target repo:

- Copy or merge `AGENTS.template.md` into the target repo root as `AGENTS.md` for Codex or OpenCode.
- Copy or merge `CLAUDE.template.md` into the target repo root as `CLAUDE.md` for Claude Code.
- Copy or merge `GEMINI.template.md` into the target repo root as `GEMINI.md` for Gemini CLI or Antigravity.

If the target repo already has `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, do not overwrite it. Merge manually or produce a diff/merge plan.

Source partials are declared in the local n8n setup project manifest:

- [_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md](/_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md)
- [_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md](/_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md)
- [skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md](partials/skill-routing-rules.md)

The assembled source-side templates live under [_projects/n8n/local-setup/_main/templates/agent-rules/](/_projects/n8n/local-setup/_main/templates/agent-rules/). The preserved original project templates remain under [_projects/n8n/local-setup/_main/templates/](/_projects/n8n/local-setup/_main/templates/). They are archival source, not the AI-facing template generation source.

Regenerate with:

```powershell
npm run build:agent-rules
node repo/scripts/sync-toolkit-projects.cjs --write
```

Generated outputs must stay deterministic. Do not edit them directly.

Generated outputs are normal Markdown files. They are not wrapped in a single giant code fence, because the n8n rules contain their own fenced examples.

The generated-template CI workflow is check-only. Future narrow writeback can be added separately if it stages only the expected generated template files and preserves the normal `npm run validate:all` merge gate.
