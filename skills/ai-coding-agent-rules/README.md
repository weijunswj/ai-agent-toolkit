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

Instruction-only skill for automatically checking and installing repo/folder-local AI coding agent instruction files and tiny platform shims.

The copied skill folder includes bare repo-local bootstrap payload templates. These files contain only the curated-source safety comment plus destination-file content and are safe to copy wholesale:

- [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) is copied or merged into target repo `AGENTS.md`.
- [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) is copied to target repo `CLAUDE.md` only when Claude Code support is requested or the target platform is Claude Code.
- [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md) is copied to target repo `GEMINI.md` for Gemini CLI or Antigravity.
- [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) is copied to target repo `.agents/rules/00-agent-toolkit-bootstrap.md` for Antigravity.

Install only the current target platform shim unless the user explicitly requests all platform shims. Repo-local installs require a selected/open target repo or an explicit target path; standalone/no-workspace chats cannot safely infer where to install repo-local files.

The repo-local templates stay generic and compact. `AGENTS.managed.template.md` is canonical for the managed toolkit block and carries the compact fail-closed n8n adapter. The Claude, Gemini, and Antigravity templates are tiny platform shims that point to root `AGENTS.md`. They do not include full n8n rules or toolkit skill-routing tables.

Do not install a shim alone. Shims require root `AGENTS.md`, created or merged from [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md), before they are useful.

Antigravity workspaces can use a tiny `.agents/rules/00-agent-toolkit-bootstrap.md` bootstrap when the folder also carries root `AGENTS.md`; do not full-import `AGENTS.md` into that bootstrap by default.

The skill is intended to run a cheap local check before coding work in GitHub, GitLab, Bitbucket, local Git, and plain project folders. If the repo/folder instruction files already have current `AI-AGENT-TOOLKIT:<source-path>` managed marker blocks, continue the original task without rewriting them.

Copy or merge a template into the matching active instruction filename only after reviewing the target repo. Never overwrite existing `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`; produce a merge or diff plan instead.

Manual global setup templates live in `_projects/development/ai-coding-agent-rules/_main/`. The published skill folder is copyable and self-contained for repo-local bootstrap use.

## Platform Entry Points

| Platform | Required repo files | Repo-local templates |
|---|---|---|
| Codex | `AGENTS.md` | [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) |
| OpenCode | `AGENTS.md` | [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md) |
| Claude Code | 1) `AGENTS.md`<br>2) `CLAUDE.md` | 1) [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md)<br>2) [repo-local/CLAUDE.shim.template.md](repo-local/CLAUDE.shim.template.md) |
| Gemini CLI | 1) `AGENTS.md`<br>2) `GEMINI.md` | 1) [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md)<br>2) [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md) |
| Antigravity | 1) `AGENTS.md`<br>2) `GEMINI.md` if using the Gemini shim<br>3) `.agents/rules/00-agent-toolkit-bootstrap.md` if using the Antigravity bootstrap | 1) [repo-local/AGENTS.managed.template.md](repo-local/AGENTS.managed.template.md)<br>2) [repo-local/GEMINI.shim.template.md](repo-local/GEMINI.shim.template.md) if using the Gemini shim<br>3) [repo-local/antigravity-bootstrap.template.md](repo-local/antigravity-bootstrap.template.md) if using the Antigravity bootstrap |

Install copied skill folders according to the target platform's supported skill location. For Antigravity, use the observed plugin-scoped custom skill path:
`C:\Users\<user>\.gemini\config\plugins\ai-agent-toolkit\skills\<skill-name>\SKILL.md`.
Keep that Antigravity skill-loading path distinct from repo-local bootstrap outputs, which still go into the target repo as `AGENTS.md`, `GEMINI.md`, and `.agents/rules/00-agent-toolkit-bootstrap.md`.
Use a minimal `plugin.json` beside `skills/` only when the installed Antigravity runtime or docs require plugin metadata.

For n8n-specific workflow and MCP safety rules, install or load [n8n-agent-rules](../n8n-agent-rules/). Do not copy the full n8n rules into global always-on generic instructions unless you intentionally accept the context cost.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/development/ai-coding-agent-rules/curated_output_for_ai/](../../_projects/development/ai-coding-agent-rules/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
