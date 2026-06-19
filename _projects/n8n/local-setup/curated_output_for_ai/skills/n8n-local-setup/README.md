<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n, hosted n8n references, local stack templates, official n8n Skills routing, and official instance-level MCP references.

## Start Here

| Need | Open |
| --- | --- |
| Beginner local setup guide | [references/n8n/local-setup.md](references/n8n/local-setup.md) |
| Hostinger Coolify VPS n8n guide | [references/n8n/hostinger-vps.md](references/n8n/hostinger-vps.md) |
| n8n reference index | [references/n8n/](references/n8n/) |
| Official n8n Skills and agent routing | [references/ai-agent-platforms/](references/ai-agent-platforms/) |
| Local stack templates | [templates/local-stack/](templates/local-stack/) |
| Official MCP config templates | [templates/mcp-configs/](templates/mcp-configs/) |

Normal use of this skill does not require `_projects/`.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Official n8n Skills plus instance-level MCP references are secondary and not part of the beginner local setup path.

## Skill Note

Copy whole toolkit-owned skill folders, not just `SKILL.md`. Official n8n Skills are upstream-owned; use the platform references for the supported upstream route.

## Agent Rules And Adapters

**If the [AI Coding Agent Rules](../ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**

**Before repo file edits, automatically check repo-local agent instructions. If they are missing, unmanaged, stale, or structurally broken, bootstrap/repair them first.**

Install or load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, import/export, credential, execution, repo/live sync, or live-instance work.

A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability.

## Safety Notes

- Keep tokens, API keys, webhook secrets, and `.env` values out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.
