<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Agent Platforms

These platform references explain how each AI platform should consume this toolkit. Generic AI coding agent rules live in [AI Coding Agent Rules](../../../ai-coding-agent-rules/); full n8n operating rules live in [n8n Agent Rules](../../../n8n-agent-rules/).

For local setup, start with [local setup](../n8n/local-setup.md). The platform pages below are secondary references for platform-specific config details.

Preferred skill install model:

| Platform | Skill install path |
| --- | --- |
| Codex | Direct whole-skill-folder install. |
| Claude Code | Direct whole-skill-folder install. |
| OpenCode | Short manual whole-skill-folder install note only. |
| Antigravity | Plugin-scoped skill-folder install. |

**Choose any one supported Codex skill-folder location:**

- `<repo>/.agents/skills/<skill-name>/`.
- `$HOME/.agents/skills/<skill-name>/`.
- `/etc/codex/skills/<skill-name>/`.

**Choose any one supported Claude Code skill-folder location:**

- `<repo>/.claude/skills/<skill-name>/`.
- `$HOME/.claude/skills/<skill-name>/`.

**Choose any one supported OpenCode skill-folder location:**

- `<repo>/.opencode/skills/<skill-name>/`.
- `$HOME/.config/opencode/skills/<skill-name>/`.
- A compatible `.agents/skills/` or `.claude/skills/` location if that is how the target OpenCode runtime is configured.

**Use the Antigravity plugin-scoped skill-folder location for toolkit skills:**

- `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md`.

Antigravity repo-local bootstrap outputs still go into the target repo, not inside the plugin-scoped skill folder:

1. `AGENTS.md`.
2. `GEMINI.md`.
3. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex and Claude Code should use direct whole-skill-folder installs.

| Reference | Use when |
| --- | --- |
| [codex.md](codex.md) | Codex platform router for local rules, references, and n8n MCP templates. |
| [claude-code.md](claude-code.md) | Setting up Claude Code skills, rules, and n8n MCP templates. |
| [chatgpt-web.md](chatgpt-web.md) | Using instruction-only skills in ChatGPT web. |
| [claude-web.md](claude-web.md) | Using instruction-only skills in Claude web. |
| [opencode.md](opencode.md) | Setting up OpenCode with agent rules and MCP config. |
| [antigravity.md](antigravity.md) | Setting up Antigravity rules and MCP config. |
