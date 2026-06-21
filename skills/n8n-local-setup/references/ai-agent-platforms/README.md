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

For local setup, start with [local setup](../n8n/local-setup.md). The platform pages below are secondary AI-coding-agent references.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. [Official n8n Skills](https://github.com/n8n-io/skills) plus instance-level MCP references are available for users intentionally enabling n8n workflow work through an AI coding agent, but they are not the beginner local setup path.

Copy the whole `skills/<skill-name>/` folder. Do not copy only `SKILL.md`. Open the platform page for exact location details.

| Platform | Preferred n8n Skills install model |
| --- | --- |
| Codex | Official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin install where hooks are supported; on Windows use the upstream "Other platforms" route plus an `AGENTS.md` cue unless the installed plugin hook metadata is Windows-safe. |
| Claude Code | Official [`n8n-io/skills`](https://github.com/n8n-io/skills) plugin install where hooks are supported; on Windows use the upstream "Other platforms" route plus an `AGENTS.md` or `CLAUDE.md` cue unless the installed plugin hook metadata is Windows-safe. |
| OpenCode | Official "Other platforms" path: `npx skills add n8n-io/skills` when supported by [skills.sh](https://skills.sh), plus an `AGENTS.md` cue because plain installs lack plugin hooks. |
| Antigravity | Official upstream n8n skill folders installed into an Antigravity plugin-scoped folder such as `C:\Users\<user>\.gemini\config\plugins\n8n-skills\skills\`, plus an `AGENTS.md` cue because local folder installs lack official plugin hooks. |

| Reference | Use when |
| --- | --- |
| [codex.md](codex.md) | Codex [official n8n Skills](https://github.com/n8n-io/skills) setup, Windows hook caveat, official MCP setup, rules, and local n8n references. |
| [claude-code.md](claude-code.md) | Claude Code [official n8n Skills](https://github.com/n8n-io/skills) setup, Windows hook caveat, official MCP setup, rules, and local n8n references. |
| [chatgpt-web.md](chatgpt-web.md) | Instruction-only skills in ChatGPT web. |
| [claude-web.md](claude-web.md) | Instruction-only skills in Claude web. |
| [opencode.md](opencode.md) | OpenCode platform-dependent n8n Skills notes, official MCP setup, rules, and local n8n references. |
| [antigravity.md](antigravity.md) | Antigravity platform-dependent n8n Skills notes, official MCP setup, rules, and local n8n references. |
