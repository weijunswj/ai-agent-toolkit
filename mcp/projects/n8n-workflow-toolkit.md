<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/mcp/n8n-workflow-toolkit.md
Update the curated output and run sync.
-->
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

## MCP-first runbook

Archived workflow cleanup is MCP-first when n8n MCP tools are available.

Use n8n MCP read/list tools first to review archived workflow candidates. The review must exclude active workflows, published workflows, and non-archived workflows, and it must make no changes.

Live archive/delete operations require explicit confirmation in the current turn. Before deleting any workflow, identify the target environment, candidate count, candidate workflow IDs and names, and whether full workflow JSON backups can be captured first.

Do not delete if full workflow backup/read is unavailable or unclear.

REST API fallback exists as a local helper script under `skills/n8n-workflow-helper-scripts/templates/helper-scripts/workflow-maintenance/delete-archived-n8n-workflows.cjs`.

Use REST API fallback only when n8n MCP tools are unavailable, insufficient, or cannot safely back up workflows before delete. Do not use REST API fallback automatically.

REST API fallback must be user-confirmed. Do not use REST API fallback unless the user explicitly confirms API fallback. The fallback script remains dry-run by default, and destructive mode still requires `--delete --confirm "DELETE ARCHIVED WORKFLOWS"` exactly.
