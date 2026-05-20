<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.local-setup
Source: _projects/n8n/local-setup/curated_output_for_ai/mcp/n8n-local-setup.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.local-setup
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# MCP Project Spec: Local n8n Setup

Project identity: `n8n.local-setup`

## Important Paths

- Project module: [_projects/n8n/local-setup/](../../_projects/n8n/local-setup/)
- Preserved source files: [_projects/n8n/local-setup/_main/](../../_projects/n8n/local-setup/_main/)
- Codex rules template: [skills/n8n-local-setup/templates/agent-rules/AGENTS.template.md](../../skills/n8n-local-setup/templates/agent-rules/AGENTS.template.md)
- Codex MCP config: [skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md](../../skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md)
- Pack: [skills/n8n-local-setup/packs/codex-n8n-local/pack.json](../../skills/n8n-local-setup/packs/codex-n8n-local/pack.json)

## Available Operations

- Read project metadata and source manifests.
- Read declared `_main` recipe sources, optional curated output when present, and AI-facing consumer surfaces.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared deterministic outputs in `toolkit.project.json`.
- No live n8n state writes.

## Denied Writes

- `.env*`, credentials, private keys, `.n8n-local/**`, `.tmp/**`, live n8n exports/imports, package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n actions are `explicit_confirmation_only` and `ci_live_actions` is `false`.
