# MCP Project Spec: Local n8n Setup

Project identity: `n8n.local-setup`

## Important Paths

- Project module: [projects/n8n/local-setup/](../../projects/n8n/local-setup/)
- Preserved source files: [projects/n8n/local-setup/main/](../../projects/n8n/local-setup/main/)
- Curated exports: [projects/n8n/local-setup/exports/](../../projects/n8n/local-setup/exports/)
- Codex rules: [templates/agent-rules/AGENTS.md](../../templates/agent-rules/AGENTS.md)
- Codex MCP config: [templates/mcp-configs/codex-mcp-config.md](../../templates/mcp-configs/codex-mcp-config.md)
- Pack: [packs/codex-n8n-local/pack.json](../../packs/codex-n8n-local/pack.json)

## Available Operations

- Read project metadata and source manifests.
- Read curated exports and root-level consumer surfaces.
- Generate deterministic declared outputs via [scripts/sync-toolkit-projects.cjs](../../scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared deterministic outputs in `toolkit.project.json`.
- No live n8n state writes.

## Denied Writes

- `.env*`, credentials, private keys, `.n8n-local/**`, `.tmp/**`, live n8n exports/imports, package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n actions are `explicit_confirmation_only` and `ci_live_actions` is `false`.
