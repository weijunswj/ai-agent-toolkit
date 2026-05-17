# MCP Project Spec: Secure CI/CD Installer

Project identity: `cicd.secure-installer`

## Important Paths

- Project module: [_projects/cicd/secure-installer/](../../../_projects/cicd/secure-installer/)
- Preserved source files: [_projects/cicd/secure-installer/_main/](../../../_projects/cicd/secure-installer/_main/)
- Templates: [for_ai/templates/cicd/](../../templates/cicd/)
- Pack: [for_ai/packs/secure-cicd/pack.json](../../packs/secure-cicd/pack.json)

## Available Operations

- Read project metadata, source manifests, pack metadata, and copy-ready templates.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared AI-facing output files in `toolkit.project.json`.
- Consumer-repo CI files only after the user reviews the pack checklist and approves the target paths.

## Denied Writes

- Secrets, `.env*`, private keys, deployment tokens, credential files, arbitrary output paths, package artifacts, destructive deletes, user home paths, and system paths.

## Live Action Restrictions

Deployment changes, credential changes, and CI mutation are `explicit_confirmation_only`. CI live actions are disabled.
