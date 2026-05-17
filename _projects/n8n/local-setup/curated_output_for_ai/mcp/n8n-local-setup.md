# MCP Project Spec: Local n8n Setup

Project identity: `n8n.local-setup`

## Important Paths

- Project module: [_projects/n8n/local-setup/](../../../_projects/n8n/local-setup/)
- Preserved source files: [_projects/n8n/local-setup/_main/](../../../_projects/n8n/local-setup/_main/)
- Codex rules: [for_ai/templates/agent-rules/AGENTS.md](../../templates/agent-rules/AGENTS.md)
- Codex MCP config: [for_ai/templates/mcp-configs/codex-mcp-config.md](../../templates/mcp-configs/codex-mcp-config.md)
- Pack: [for_ai/packs/codex-n8n-local/pack.json](../../packs/codex-n8n-local/pack.json)

## Available Operations

- Read project metadata and source manifests.
- Read declared `_main` recipe sources, optional curated output when present, and AI-facing consumer surfaces.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared deterministic outputs in `toolkit.project.json`.
- No live n8n state writes.

## Denied Writes

- `.env*`, credentials, private keys, `.n8n-local/**`, `.tmp/**`, live n8n exports/imports, package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n actions are `explicit_confirmation_only` and `ci_live_actions` is `false`.
