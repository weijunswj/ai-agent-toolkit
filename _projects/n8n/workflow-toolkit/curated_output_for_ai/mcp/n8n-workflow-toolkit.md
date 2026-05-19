<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# MCP Project Spec: n8n Workflow Toolkit

Project identity: `n8n.workflow-toolkit`

## Important Paths

- Project module: [_projects/n8n/workflow-toolkit/](../../_projects/n8n/workflow-toolkit/)
- Preserved source files: [_projects/n8n/workflow-toolkit/_main/](../../_projects/n8n/workflow-toolkit/_main/)
- Helper scripts skill: [skills/n8n-workflow-helper-scripts/](../../skills/n8n-workflow-helper-scripts/)
- Workflow templates skill: [skills/n8n-workflow-templates/](../../skills/n8n-workflow-templates/)

## Available Operations

- Read project metadata and source manifests.
- Read helper-script template sources.
- Read public generic workflow template sources.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared AI-facing output files in `toolkit.project.json`.
- Consumer-repo writes only after review, such as scoped `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, `.to-sanitise/**`, or `.sanitised/**` staging when a copied helper is intentionally run in that consumer repo.

## Denied Writes

- `.env*`, credentials, credential bindings, private keys, live n8n exports/imports committed to repo, generated package artifacts, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

Live n8n import/export, execution, activation, deactivation, publish, unpublish, archive, delete, and credential actions are `explicit_confirmation_only`. CI live actions are disabled.
