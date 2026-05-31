<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n setup, Docker Compose plus Postgres, Compose ngrok, Hostinger VPS, launcher/menu use, skills-first agent guidance, and optional AI-coding-agent MCP feature references.

## Start Here

| Need | Open |
| --- | --- |
| Beginner local setup guide | [references/n8n/local-setup.md](references/n8n/local-setup.md) |
| Hostinger VPS guide | [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md) |
| n8n reference index | [references/n8n/](references/n8n/) |
| Skills-first agent guidance | [references/ai-agent-platforms/](references/ai-agent-platforms/) |
| Local stack templates | [templates/local-stack/](templates/local-stack/) |
| Optional MCP config templates | [templates/mcp-configs/](templates/mcp-configs/) |

Normal use of this skill does not require `_projects/`.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional AI-coding-agent MCP feature references are secondary and not part of the beginner local setup path.

## Skill Install Note

Copy whole skill folders, not just `SKILL.md`.

| Platform | Current install path |
| --- | --- |
| Codex | Direct whole-skill-folder install. |
| Claude Code | Direct whole-skill-folder install. |
| OpenCode | Short manual whole-skill-folder install note only. |
| Antigravity | Plugin-scoped skill-folder install. |

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

**Before repo file edits, automatically check repo-local agent instructions. If they are missing, unmanaged, stale, or structurally broken, bootstrap/repair them first.**

Install or load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, import/export, credential, execution, repo/live sync, or live-instance work.

A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability.

## Safety Notes

- Keep tokens, API keys, webhook secrets, and `.env` values out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.
