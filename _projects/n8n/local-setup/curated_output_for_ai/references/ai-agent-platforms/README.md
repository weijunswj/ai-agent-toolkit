<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# AI Agent Platforms

These platform references route each AI platform to this toolkit. Generic rules live in [AI Coding Agent Rules](../../../ai-coding-agent-rules/); full n8n rules live in [n8n Agent Rules](../../../n8n-agent-rules/).

For local setup, start with [local setup](../n8n/local-setup.md). The platform pages below are secondary AI-coding-agent references.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional MCP feature setup/config references are available for users intentionally enabling n8n MCP for an AI coding agent, but they are not the beginner local setup path.

Copy the whole `skills/<skill-name>/` folder. Do not copy only `SKILL.md`. Open the platform page for exact location details.

| Platform | Preferred skill install model |
| --- | --- |
| Codex | Direct whole-skill-folder install. |
| Claude Code | Direct whole-skill-folder install. |
| OpenCode | Short manual whole-skill-folder install note only. |
| Antigravity | Plugin-scoped skill-folder install. |

| Reference | Use when |
| --- | --- |
| [codex.md](codex.md) | Optional Codex MCP feature setup, skills, rules, and local n8n references. |
| [claude-code.md](claude-code.md) | Optional Claude Code MCP feature setup, skills, rules, and local n8n references. |
| [chatgpt-web.md](chatgpt-web.md) | Instruction-only skills in ChatGPT web. |
| [claude-web.md](claude-web.md) | Instruction-only skills in Claude web. |
| [opencode.md](opencode.md) | Optional OpenCode MCP feature setup, skills, rules, and local n8n references. |
| [antigravity.md](antigravity.md) | Optional Antigravity MCP feature setup, skills, rules, and local n8n references. |
