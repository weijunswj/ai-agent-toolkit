<!--
Curated AI-facing source.
Project: development.ai-coding-agent-rules
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Coding Agent Rules Skill

Instruction-only skill for automatically checking and installing repo/folder-local AI coding agent instruction files and lightweight compatibility shims.

The copied skill folder includes inert generic baseline templates:

- [AGENTS.template.md](AGENTS.template.md) for Codex or OpenCode.
- [CLAUDE.template.md](CLAUDE.template.md) for Claude Code.
- [GEMINI.template.md](GEMINI.template.md) for Gemini CLI or Antigravity.
- [ANTIGRAVITY.bootstrap.template.md](ANTIGRAVITY.bootstrap.template.md) for `.agents/rules/00-agent-toolkit-bootstrap.md`.

The baseline templates stay generic and compact. `AGENTS.template.md` carries the canonical shared contract, while `CLAUDE.template.md` and `GEMINI.template.md` are compatibility shims that import `AGENTS.md`. They do not include full n8n rules or toolkit skill-routing tables.

Antigravity workspaces can use a tiny `.agents/rules/00-agent-toolkit-bootstrap.md` bootstrap when the folder also carries root `AGENTS.md`; do not full-import `AGENTS.md` into that bootstrap by default.

The skill is intended to run a cheap local check before coding work in GitHub, GitLab, Bitbucket, local Git, and plain project folders. If the repo/folder instruction files already have current `AI-AGENT-TOOLKIT` managed marker blocks, continue the original task without rewriting them.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

## Platform Entry Points

| Platform | Rules template | Setup reference |
|---|---|---|
| Codex | [AGENTS.template.md](AGENTS.template.md) | [Codex reference](../n8n-local-setup/references/ai-agent-platforms/codex.md) |
| OpenCode | [AGENTS.template.md](AGENTS.template.md) | [OpenCode reference](../n8n-local-setup/references/ai-agent-platforms/opencode.md) |
| Claude Code | [CLAUDE.template.md](CLAUDE.template.md) | [Claude Code reference](../n8n-local-setup/references/ai-agent-platforms/claude-code.md) |
| Antigravity | [ANTIGRAVITY.bootstrap.template.md](ANTIGRAVITY.bootstrap.template.md) | [Antigravity reference](../n8n-local-setup/references/ai-agent-platforms/antigravity.md) |

Install copied skill folders according to the target platform's supported skill location. Use the setup references for platform-specific skill, MCP config, and restart notes.

For n8n-specific workflow and MCP safety rules, install or load [n8n-agent-rules](../n8n-agent-rules/). Do not copy the full n8n rules into global always-on generic instructions unless you intentionally accept the context cost.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
