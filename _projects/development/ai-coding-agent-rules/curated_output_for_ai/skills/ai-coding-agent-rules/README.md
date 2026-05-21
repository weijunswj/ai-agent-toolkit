<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules Skill

Instruction-only skill for installing generic execution-first AI coding agent rules.

The copied skill folder includes inert templates under `templates/agent-rules/`:

- `AGENTS.template.md` for Codex or OpenCode.
- `CLAUDE.template.md` for Claude Code.
- `GEMINI.template.md` for Gemini CLI or Antigravity.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

For n8n-specific workflow and MCP safety rules, install `skills/n8n-local-setup` and use its `templates/agent-rules/n8n-mcp-rules.template.md` add-on after the generic baseline.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
