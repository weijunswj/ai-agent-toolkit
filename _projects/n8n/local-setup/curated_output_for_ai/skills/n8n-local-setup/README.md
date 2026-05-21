<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup Skill

Instruction-only skill for safe local n8n setup, MCP config routing, n8n-specific agent-rule add-ons, and platform setup guidance.

The copied skill folder includes full-fidelity local setup references under `references/n8n/` and platform references under `references/ai-agent-platforms/`, so normal use of the skill does not require `_projects/`.

For generic AI coding agent rules, install `skills/ai-coding-agent-rules`.

For n8n-specific workflow and MCP safety rules, use `templates/agent-rules/n8n-mcp-rules.template.md` from this skill as an add-on after the generic baseline.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/n8n/local-setup/curated_output_for_ai/](../../_projects/n8n/local-setup/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
