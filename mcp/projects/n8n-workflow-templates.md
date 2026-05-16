<!--
Generated from toolkit project exports. Do not edit directly.
Project: n8n.workflow-templates
Source: projects/n8n/workflow-templates/exports/mcp/n8n-workflow-templates.md
Update the source project export and run the sync/check workflow.
-->
# MCP Project Spec: n8n Workflow Templates

Project identity: `n8n.workflow-templates`

## Important Paths

- Project module: [projects/n8n/workflow-templates/](../../projects/n8n/workflow-templates/)
- Preserved source files: [projects/n8n/workflow-templates/main/](../../projects/n8n/workflow-templates/main/)
- Curated exports: [projects/n8n/workflow-templates/exports/](../../projects/n8n/workflow-templates/exports/)
- Workflow sync skill: [skills/automation/n8n-workflow-sync/](../../skills/automation/n8n-workflow-sync/)
- Sanitizer helpers: [templates/n8n/sanitizer/](../../templates/n8n/sanitizer/)
- Workflow policy: [templates/n8n/workflow-policy/](../../templates/n8n/workflow-policy/)

## Available Operations

- Read project metadata and source manifests.
- Read sanitizer and workflow-policy template sources.
- Generate deterministic declared outputs via [scripts/sync-toolkit-projects.cjs](../../scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared root-level output files in `toolkit.project.json`.
- Consumer-repo writes only after review, such as scoped `n8n-workflows/*.json`, ignored `.tmp/**`, or ignored `.n8n-local/**` staging when a copied helper is intentionally run in that consumer repo.

## Denied Writes

- `.env*`, credentials, credential bindings, private keys, live n8n exports/imports committed to repo, generated package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n import/export, execution, activation, deactivation, publish, unpublish, archive, delete, and credential actions are `explicit_confirmation_only`. CI live actions are disabled.
