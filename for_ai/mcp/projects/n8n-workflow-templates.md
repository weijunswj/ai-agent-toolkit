<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-templates
Source: _projects/n8n/workflow-templates/curated_output_for_ai/mcp/n8n-workflow-templates.md
Update the curated output and run sync.
-->
# MCP Project Spec: n8n Workflow Templates

Project identity: `n8n.workflow-templates`

## Important Paths

- Project module: [_projects/n8n/workflow-templates/](../../../_projects/n8n/workflow-templates/)
- Preserved source files: [_projects/n8n/workflow-templates/_main/](../../../_projects/n8n/workflow-templates/_main/)
- Workflow sync skill: [for_ai/skills/automation/n8n-workflow-sync/](../../skills/automation/n8n-workflow-sync/)
- Sanitizer helpers: [for_ai/templates/n8n/sanitizer/](../../templates/n8n/sanitizer/)
- Workflow policy: [for_ai/templates/n8n/workflow-policy/](../../templates/n8n/workflow-policy/)

## Available Operations

- Read project metadata and source manifests.
- Read sanitizer and workflow-policy template sources.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared AI-facing output files in `toolkit.project.json`.
- Consumer-repo writes only after review, such as scoped `n8n-workflows/*.json`, ignored `.tmp/**`, or ignored `.n8n-local/**` staging when a copied helper is intentionally run in that consumer repo.

## Denied Writes

- `.env*`, credentials, credential bindings, private keys, live n8n exports/imports committed to repo, generated package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n import/export, execution, activation, deactivation, publish, unpublish, archive, delete, and credential actions are `explicit_confirmation_only`. CI live actions are disabled.
