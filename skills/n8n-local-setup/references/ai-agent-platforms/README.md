<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Agent Platforms

These platform references route each AI platform to this toolkit. Generic rules live in [AI Coding Agent Rules](../../../ai-coding-agent-rules/); full n8n rules live in [n8n Agent Rules](../../../n8n-agent-rules/).

For local setup, start with [local setup](../n8n/local-setup.md). The platform pages below are secondary references for platform-specific config details.

Copy the whole `skills/<skill-name>/` folder. Do not copy only `SKILL.md`.

| Platform | Preferred skill install model |
| --- | --- |
| Codex | Direct whole-skill-folder install. |
| Claude Code | Direct whole-skill-folder install. |
| OpenCode | Short manual whole-skill-folder install note only. |
| Antigravity | Plugin-scoped skill-folder install. |

| Platform | Supported skill-folder locations |
| --- | --- |
| Codex | Choose any one supported Codex skill-folder location:<br>- `<repo>/.agents/skills/<skill-name>/`<br>- `$HOME/.agents/skills/<skill-name>/`<br>- `/etc/codex/skills/<skill-name>/` |
| Claude Code | Choose any one supported Claude Code skill-folder location:<br>- `<repo>/.claude/skills/<skill-name>/`<br>- `$HOME/.claude/skills/<skill-name>/` |
| OpenCode | Choose any one supported OpenCode skill-folder location:<br>- `<repo>/.opencode/skills/<skill-name>/`<br>- `$HOME/.config/opencode/skills/<skill-name>/`<br>- A compatible `.agents/skills/` or `.claude/skills/` location if that is how the target OpenCode runtime is configured. |
| Antigravity | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` |

Antigravity repo-local bootstrap outputs still go into the target repo, not inside the plugin-scoped skill folder:

1. `AGENTS.md`.
2. `GEMINI.md`.
3. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex and Claude Code should use direct whole-skill-folder installs.

| Reference | Use when |
| --- | --- |
| [codex.md](codex.md) | Codex rules, references, and n8n MCP templates. |
| [claude-code.md](claude-code.md) | Claude Code skills, rules, and n8n MCP templates. |
| [chatgpt-web.md](chatgpt-web.md) | Instruction-only skills in ChatGPT web. |
| [claude-web.md](claude-web.md) | Instruction-only skills in Claude web. |
| [opencode.md](opencode.md) | OpenCode rules and MCP config. |
| [antigravity.md](antigravity.md) | Antigravity rules and MCP config. |
