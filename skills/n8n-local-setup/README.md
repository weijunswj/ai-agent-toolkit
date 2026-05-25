<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n setup, MCP config routing, Docker/tunnel setup, and platform setup guidance.

The copied skill folder includes:

- [n8n setup references](references/n8n/)
- [AI-agent platform references](references/ai-agent-platforms/)
- [MCP config templates](templates/mcp-configs/)

Normal use of this skill does not require `_projects/`.

Install [AI Coding Agent Rules](../ai-coding-agent-rules/) for generic agent rules. Install or load [n8n Agent Rules](../n8n-agent-rules/) before n8n workflow, MCP, import/export, credential, execution, repo/live sync, or live-instance work.

A generated cross-skill copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability. It is generated from the canonical `development.ai-coding-agent-rules` source and must not be edited directly.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/n8n/local-setup/curated_output_for_ai/](../../_projects/n8n/local-setup/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
