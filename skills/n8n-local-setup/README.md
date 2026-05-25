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

The copied skill folder includes full-fidelity local setup references under `references/n8n/` and platform references under `references/ai-agent-platforms/`, so normal use of the skill does not require `_projects/`.

For generic AI coding agent rules, install `skills/ai-coding-agent-rules`.

For n8n-specific workflow and MCP safety rules, install or load `skills/n8n-agent-rules`. This skill depends on `n8n-agent-rules` for workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, helper scripts, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and live n8n safety.

A generated cross-skill copy is available at `references/n8n-agent-rules.md` for portability when this skill folder is copied without the full toolkit. It is generated from the canonical `development.ai-coding-agent-rules` source and must not be edited directly.

The `SKILL.md` file is an AI-facing published surface generated from [_projects/n8n/local-setup/curated_output_for_ai/](../../_projects/n8n/local-setup/curated_output_for_ai/). Update the curated source, then run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
```
