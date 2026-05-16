---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup, MCP config selection, tunneling choices, and platform-specific agent-rule setup without running live n8n actions unless explicitly confirmed.
---

<!--
Generated from toolkit project exports. Do not edit directly.
Project: n8n.local-setup
Source: projects/n8n/local-setup/exports/skills/n8n-local-setup.md
Update the source project export and run the sync/check workflow.
-->
# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, agent rules, MCP config, tunneling, Docker Compose plus ngrok, VPS hosting notes, or platform integrations for Codex, Claude Code, OpenCode, or Antigravity.

## Source Module

- Project module: [projects/n8n/local-setup/](../../../projects/n8n/local-setup/)
- Full source docs: [projects/n8n/local-setup/main/](../../../projects/n8n/local-setup/main/)
- Curated exports: [projects/n8n/local-setup/exports/](../../../projects/n8n/local-setup/exports/)

## Core Rules

- Treat [projects/n8n/local-setup/main/](../../../projects/n8n/local-setup/main/) as the full source of truth for original setup docs.
- Use root [guides/n8n/](../../../guides/n8n/) for concise consumer-facing quickstarts.
- Keep tokens, API keys, webhook secrets, and MCP credentials out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Codex rules: [templates/agent-rules/AGENTS.md](../../../templates/agent-rules/AGENTS.md)
- Codex MCP config: [templates/mcp-configs/codex-mcp-config.md](../../../templates/mcp-configs/codex-mcp-config.md)
- Local setup guide: [guides/n8n/local-setup.md](../../../guides/n8n/local-setup.md)
- Pack checklist: [packs/codex-n8n-local/pack.json](../../../packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant source file in `projects/n8n/local-setup/main/` when exact setup detail matters.
3. Point the user to the root-level template or guide when they need copy-ready material.
4. Keep live actions safety-gated and separate from docs/template work.
