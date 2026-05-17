---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup, MCP config selection, tunneling choices, and platform-specific agent-rule setup without running live n8n actions unless explicitly confirmed.
---

<!--
Root published toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: n8n.local-setup
Review the related _projects/**/_main source when updating.
-->
# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, agent rules, MCP config, tunneling, Docker Compose plus ngrok, VPS hosting notes, or platform integrations for Codex, Claude Code, OpenCode, or Antigravity.

## Source Module

- Project module: [_projects/n8n/local-setup/](../../../_projects/n8n/local-setup/)
- Full source docs: [_projects/n8n/local-setup/_main/](../../../_projects/n8n/local-setup/_main/)

## Core Rules

- Treat [_projects/n8n/local-setup/_main/](../../../_projects/n8n/local-setup/_main/) as the full source of truth for original setup docs.
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
2. Read the relevant source file in `_projects/n8n/local-setup/_main/` when exact setup detail matters.
3. Point the user to the root-level template or guide when they need copy-ready material.
4. Keep live actions safety-gated and separate from docs/template work.
