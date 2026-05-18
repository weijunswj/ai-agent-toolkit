<!--
AI-facing toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: design.ui-ux-pro-max
Review the related _projects/**/_main source when updating.
-->
# MCP Project Spec: UI/UX Pro Max Design

Project identity: `design.ui-ux-pro-max`

## Important Paths

- Project module: [_projects/design/ui-ux-pro-max/](../../_projects/design/ui-ux-pro-max/)
- Preserved local-only subset: [_projects/design/ui-ux-pro-max/_main/](../../_projects/design/ui-ux-pro-max/_main/)
- Instruction-only skill: [skills/ui-ux-secure-frontend-design/](../../skills/ui-ux-secure-frontend-design/)
- Optional local tool: [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/)

## Available Operations

- Read project metadata, source manifests, third-party notes, and local CSV-backed design recommendations.
- Generate deterministic declared outputs via [repo/scripts/sync-toolkit-projects.cjs](../../repo/scripts/sync-toolkit-projects.cjs).

## Safe Writes

- Declared AI-facing output files in `toolkit.project.json`.
- Optional generator output only under `skills/ui-ux-secure-frontend-design/tools/design-system-generator/output/**` when explicitly requested.

## Denied Writes

- Network downloads, package installs, shell execution, `.env*`, credentials, private keys, arbitrary output paths, user home paths, and system paths.

## Live Action Restrictions

There are no live service actions. Any write outside declared deterministic outputs requires explicit approval.
