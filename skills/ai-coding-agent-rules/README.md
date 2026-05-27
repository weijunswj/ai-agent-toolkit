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

Instruction-only skill for automatically checking and installing repo/folder-local AI coding agent instruction files and lightweight compatibility shims.

The copied skill folder includes inert repo-local bootstrap templates:

- [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) for Codex or OpenCode.
- [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) for Claude Code.
- [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md) for Gemini CLI or Antigravity.
- [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) for `.agents/rules/00-agent-toolkit-bootstrap.md`.

The repo-local templates stay generic and compact. `AGENTS.managed.template.md` carries the managed toolkit block and one-line n8n adapter, while the Claude, Gemini, and Antigravity templates are tiny compatibility shims that point to root `AGENTS.md`. They do not include full n8n rules or toolkit skill-routing tables.

Top-level `AGENTS.template.md`, `CLAUDE.template.md`, `GEMINI.template.md`, and `antigravity-bootstrap.template.md` are retained only as repo-local compatibility aliases for older links. New integrations should use the `repo-local/` paths above.

Antigravity workspaces can use a tiny `.agents/rules/00-agent-toolkit-bootstrap.md` bootstrap when the folder also carries root `AGENTS.md`; do not full-import `AGENTS.md` into that bootstrap by default.

The skill is intended to run a cheap local check before coding work in GitHub, GitLab, Bitbucket, local Git, and plain project folders. If the repo/folder instruction files already have current `AI-AGENT-TOOLKIT` managed marker blocks, continue the original task without rewriting them.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

For human/manual global setup reference docs, use the source project under `_projects/development/ai-coding-agent-rules/_main/`. The published skill folder is copyable and self-contained for repo-local bootstrap use.

## Platform Entry Points

| Platform | Repo-local template |
|---|---|
| Codex | [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) |
| OpenCode | [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) |
| Claude Code | [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) |
| Gemini CLI | [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md) |
| Antigravity | [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) |

Install copied skill folders according to the target platform's supported skill location.

For n8n-specific workflow and MCP safety rules, install or load [n8n-agent-rules](../n8n-agent-rules/). Do not copy the full n8n rules into global always-on generic instructions unless you intentionally accept the context cost.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
