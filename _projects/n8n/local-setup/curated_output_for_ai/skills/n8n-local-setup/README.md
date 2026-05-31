<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n setup, MCP config routing, Docker Compose plus Postgres, ngrok, and platform setup guidance.

## Start Here

| Need | Open |
| --- | --- |
| Beginner local setup guide | [references/n8n/local-setup.md](references/n8n/local-setup.md) |
| Hostinger VPS guide | [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md) |
| n8n reference index | [references/n8n/](references/n8n/) |
| AI-agent platform setup | [references/ai-agent-platforms/](references/ai-agent-platforms/) |
| Local stack templates | [templates/local-stack/](templates/local-stack/) |
| MCP config templates | [templates/mcp-configs/](templates/mcp-configs/) |

Normal use of this skill does not require `_projects/`.

## Skill Install Note

Copy whole skill folders, not just `SKILL.md`.

| Platform | Current install path |
| --- | --- |
| Codex | Direct whole-skill-folder install. |
| Claude Code | Direct whole-skill-folder install. |
| OpenCode | Short manual whole-skill-folder install note only. |
| Antigravity | Plugin-scoped skill-folder install. |

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet.

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

**Before repo file edits, automatically check repo-local agent instructions. If they are missing, unmanaged, stale, or structurally broken, bootstrap/repair them first.**

Install or load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, MCP, import/export, credential, execution, repo/live sync, or live-instance work.

A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability.

## Safety Notes

- Keep tokens, API keys, webhook secrets, `.env` values, and MCP credentials out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Maintainer Note

The `SKILL.md` file is generated from [_projects/n8n/local-setup/curated_output_for_ai/](../../_projects/n8n/local-setup/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
