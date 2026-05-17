# Write Safety Model

This toolkit allows writes only when they are required, scoped, declared, reviewed, and safe.

## Required Project Policy

Every `_projects/**/toolkit.project.json` must include:

- `writes.allowed`
- `writes.denied`
- `requires_approval`
- `run_commands_by_default`
- `live_actions`
- `ci_live_actions`

Expected defaults:

- `requires_approval`: `true`
- `run_commands_by_default`: `false`
- `live_actions`: `explicit_confirmation_only`
- `ci_live_actions`: `false`

## Allowed Writes

Allowed writes must be declared and deterministic, such as:

- Generated root-level toolkit outputs declared in `toolkit.project.json`.
- A reviewed n8n sync helper writing `n8n-workflows/*.json` in a consumer repo.
- Ignored consumer-repo staging writes like `.tmp/**` or `.n8n-local/**` when the helper explicitly declares them.
- Optional design generator output under `for_ai/tools/design-system-generator/output/` when explicitly requested.

## Denied Writes

Denied writes include:

- `.env*`
- credentials and credential bindings
- private keys
- live n8n exports/imports committed to repo
- arbitrary output paths
- user home or system paths
- destructive deletes
- generated package artifacts
- package install side effects
- network downloads

## CI Rules

CI must not run live actions, import/export n8n workflows, activate/deactivate workflows, mutate credentials, install packages from project modules, or execute scripts merely because they exist under `_projects/**/_main/`.

## Sync Enforcement

[repo/scripts/sync-toolkit-projects.cjs](../scripts/sync-toolkit-projects.cjs) validates project shape, export declarations, root-output paths, write policy fields, forbidden files, and stale generated outputs.
