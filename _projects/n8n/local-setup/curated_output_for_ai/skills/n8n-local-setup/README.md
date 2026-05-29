<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n setup, MCP config routing, Docker Compose plus Postgres, ngrok tunnel setup, and platform setup guidance.

The copied skill folder includes:

- [n8n setup references](references/n8n/)
- [AI-agent platform references](references/ai-agent-platforms/)
- [local Docker Compose stack templates](templates/local-stack/)
- [MCP config templates](templates/mcp-configs/)

Start with [references/n8n/local-setup.md](references/n8n/local-setup.md). It is the primary one-stop-shop local guide for setup, menu use, update checks, tunnel behavior, URLs, MCP, platform setup, troubleshooting, and daily commands.

For skill installation, use direct whole-skill-folder installs for Codex and Claude Code, plugin-scoped skill-folder install for Antigravity, and a short manual whole-skill-folder install note for OpenCode. Copy whole skill folders, not just `SKILL.md`.

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex and Claude Code should use direct whole-skill-folder installs.

The local Fast Path is `n8n + postgres + ngrok` through Docker Compose. Start it through [templates/local-stack/n8n-local.cmd](templates/local-stack/n8n-local.cmd) for the guided menu, update checks, logs, status, browser links, and Postgres backup action. ngrok is the only supported local tunnel path in this guide, and [.env.example](templates/local-stack/.env.example) is placeholder-only.

Normal use of this skill does not require `_projects/`.

Before repo file edits, automatically check repo-local agent instructions. If they are missing, unmanaged, stale, or structurally broken, bootstrap/repair them first. Install or load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, MCP, import/export, credential, execution, repo/live sync, or live-instance work.

A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability. It is generated from the canonical `development.ai-coding-agent-rules` source and must not be edited directly.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/n8n/local-setup/curated_output_for_ai/](../../_projects/n8n/local-setup/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
