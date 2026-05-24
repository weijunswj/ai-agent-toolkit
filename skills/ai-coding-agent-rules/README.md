<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.ai-coding-agent-rules
Source: _projects/development/ai-coding-agent-rules/curated_output_for_ai/skills/ai-coding-agent-rules/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules Skill

Instruction-only skill for installing generic execution-first AI coding agent rules.

The copied skill folder includes inert generic baseline templates:

- `AGENTS.template.md` for Codex or OpenCode.
- `CLAUDE.template.md` for Claude Code.
- `GEMINI.template.md` for Gemini CLI or Antigravity.

The baseline templates stay generic. They do not include toolkit skill-routing.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

## Platform Entry Points

| Platform | Always-on rules template | Related setup reference |
|---|---|---|
| Codex | `AGENTS.template.md` | `skills/n8n-local-setup/references/ai-agent-platforms/codex.md` |
| OpenCode | `AGENTS.template.md` | `skills/n8n-local-setup/references/ai-agent-platforms/opencode.md` |
| Claude Code | `CLAUDE.template.md` | `skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md` |
| Antigravity | `GEMINI.template.md` | `skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md` |

Install copied skill folders according to the target platform's supported skill location. Use the setup references for platform-specific rules, MCP config, and restart notes.

`TOOLKIT-SKILL-ROUTING.template.md` is optional. Use it only when the target environment has this toolkit's `skills/` folders installed or copied. Do not use it as a standalone replacement for the generic baseline; merge it under the generic baseline in the same active instruction file.

Published one-shot convenience alternatives are available when the target environment has this toolkit's `skills/` folders installed or copied:

- `AGENTS.with-toolkit-skills.template.md`
- `CLAUDE.with-toolkit-skills.template.md`
- `GEMINI.with-toolkit-skills.template.md`

These combine the generic baseline plus toolkit skill-routing. They are equivalent to installing the matching baseline template and then merging `TOOLKIT-SKILL-ROUTING.template.md`. They are skill-side conveniences, not source-side `_main` canonical templates.

For n8n-specific workflow and MCP safety rules, install the generic baseline first, then merge the n8n add-on from `skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md`.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
