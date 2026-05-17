---
name: n8n-local-setup
description: Guide AI agents through safe local n8n setup, MCP config selection, tunneling choices, and platform-specific agent-rule setup without running live n8n actions unless explicitly confirmed.
---

# n8n Local Setup

Use this skill when the user needs to set up or explain local n8n, agent rules, MCP config, tunneling, Docker Compose plus ngrok, VPS hosting notes, or platform integrations for Codex, Claude Code, OpenCode, or Antigravity.

## Source Module

- Project module: [_projects/n8n/local-setup/](../../../../_projects/n8n/local-setup/)
- Full source docs: [_projects/n8n/local-setup/_main/](../../../../_projects/n8n/local-setup/_main/)

## Core Rules

- Treat [_projects/n8n/local-setup/_main/](../../../../_projects/n8n/local-setup/_main/) as the full source of truth for original setup docs.
- Use [for_ai/playbooks/n8n/](../../../playbooks/n8n/) for concise AI/operator playbooks.
- Keep tokens, API keys, webhook secrets, and MCP credentials out of repo files.
- Do not run live n8n import/export, workflow activation, execution, publish, unpublish, archive, delete, or credential actions from this toolkit repo.
- For live n8n work, require explicit current-turn confirmation and identify the target instance first.

## Common Outputs

- Codex rules: [for_ai/templates/agent-rules/AGENTS.md](../../../templates/agent-rules/AGENTS.md)
- Codex MCP config: [for_ai/templates/mcp-configs/codex-mcp-config.md](../../../templates/mcp-configs/codex-mcp-config.md)
- Local setup playbook: [for_ai/playbooks/n8n/local-setup.md](../../../playbooks/n8n/local-setup.md)
- Pack checklist: [for_ai/packs/codex-n8n-local/pack.json](../../../packs/codex-n8n-local/pack.json)

## Workflow

1. Confirm the user's target platform and whether they want docs, templates, or a local setup diagnosis.
2. Read the relevant source file in `_projects/n8n/local-setup/_main/` when exact setup detail matters.
3. Point the user to the AI-facing template or playbook when they need copy-ready material.
4. Keep live actions safety-gated and separate from repo/docs/template work.
