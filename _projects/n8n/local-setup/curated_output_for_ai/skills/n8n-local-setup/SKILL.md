---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup, MCP config selection, tunneling choices, Docker setup, and platform setup notes. For any n8n workflow, helper-script, MCP, or live n8n task, first apply n8n-agent-rules.
---

<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, MCP config, tunneling, Docker Compose plus ngrok, VPS hosting notes, or platform integrations for Codex, Claude Code, OpenCode, or Antigravity.

For any n8n workflow, helper-script, MCP, `n8n_docs`, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n task, apply `n8n-agent-rules` first.

## Source And Runtime Material

- Runtime references live inside this copied skill folder under [references/n8n/](references/n8n/) and [references/ai-agent-platforms/](references/ai-agent-platforms/).
- Project provenance lives under [_projects/n8n/local-setup/](../../_projects/n8n/local-setup/) in the toolkit repo, but normal use of a copied skill folder must not require `_projects/`.

## Core Rules

- Use the local full-fidelity references in [references/n8n/](references/n8n/) for setup, upgrade, tunneling, Docker Compose plus ngrok, and VPS hosting details.
- Use [references/ai-agent-platforms/](references/ai-agent-platforms/) for Codex, Claude Code, OpenCode, Antigravity, ChatGPT web, and Claude web routing.
- Use `skills/ai-coding-agent-rules` for generic AI coding agent rules.
- Use `skills/n8n-agent-rules` or [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for the full n8n operating ruleset.
- Keep tokens, API keys, webhook secrets, and MCP credentials out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Generic Codex rules template: `skills/ai-coding-agent-rules/AGENTS.template.md`
- n8n rules skill: `skills/n8n-agent-rules`
- n8n rules local reference: [references/n8n-agent-rules.md](references/n8n-agent-rules.md)
- Codex MCP config: [templates/mcp-configs/codex-mcp-config.md](templates/mcp-configs/codex-mcp-config.md)
- Local setup reference: [references/n8n/local-setup.md](references/n8n/local-setup.md)
- Upgrade reference: [references/n8n/upgrading.md](references/n8n/upgrading.md)
- Claude Code reference: [references/ai-agent-platforms/claude-code.md](references/ai-agent-platforms/claude-code.md)
- Pack checklist: [packs/codex-n8n-local/pack.json](packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant local reference file inside this skill folder when exact setup detail matters.
3. Point the user to the AI-facing template, skill, or reference when they need copy-ready material.
4. Keep live actions safety-gated and separate from repo/docs/template work.
