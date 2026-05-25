<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules Skill

Instruction-only skill for installing generic execution-first AI coding agent rules.

The copied skill folder includes inert generic baseline templates:

- [AGENTS.template.md](AGENTS.template.md) for Codex or OpenCode.
- [CLAUDE.template.md](CLAUDE.template.md) for Claude Code.
- [GEMINI.template.md](GEMINI.template.md) for Gemini CLI or Antigravity.

The baseline templates stay generic and compact. They do not include full n8n rules, toolkit skill-routing tables, Codex-specific install paths, Claude-specific memory/import sections, OpenCode-specific sections, or Antigravity-specific sections.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

## Platform Entry Points

| Platform | Rules template | Setup reference |
|---|---|---|
| Codex | [AGENTS.template.md](AGENTS.template.md) | [Codex reference](../n8n-local-setup/references/ai-agent-platforms/codex.md) |
| OpenCode | [AGENTS.template.md](AGENTS.template.md) | [OpenCode reference](../n8n-local-setup/references/ai-agent-platforms/opencode.md) |
| Claude Code | [CLAUDE.template.md](CLAUDE.template.md) | [Claude Code reference](../n8n-local-setup/references/ai-agent-platforms/claude-code.md) |
| Antigravity | [GEMINI.template.md](GEMINI.template.md) | [Antigravity reference](../n8n-local-setup/references/ai-agent-platforms/antigravity.md) |

Install copied skill folders according to the target platform's supported skill location. Use the setup references for platform-specific skill, MCP config, and restart notes.

For n8n-specific workflow and MCP safety rules, install or load [n8n-agent-rules](../n8n-agent-rules/). Do not copy the full n8n rules into global always-on generic instructions unless you intentionally accept the context cost.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
