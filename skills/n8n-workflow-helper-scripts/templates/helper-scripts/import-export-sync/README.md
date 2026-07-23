<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/templates/helper-scripts/import-export-sync/README.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Import Export Sync Helpers

This folder contains review-required helper templates for n8n workflow import/export sync.

They are meant to be copied into a consumer repository that intentionally owns n8n workflow JSON under `n8n-workflows/`.

Live import/export helper entry points are not run from this toolkit repo during CI. Non-live validation, sanitizer, sync, compare, and prepare logic may be exercised by tests.

## Consumer Repo Layout

- Committed n8n workflow export JSON belongs under the repo root `n8n-workflows/`.
- If `n8n-workflows/` exists, include `n8n-workflows/README.md` describing the workflow set, safety notes, and validation command.
- When Toolkit creates or manages `n8n-workflows/`, copy or sync this approved helper folder into `n8n-workflows/scripts/`.
- Do not store committed workflow JSON under `docs/`, `scripts/`, `.n8n/`, `.tmp/`, app folders, or random scratch paths.
- Use stable lowercase hyphenated filenames such as `member-intake-small-batch.json`; reserve `archived/` for intentionally retained old exports.

## Included Helpers

- `export-n8n-workflows-live.ps1`
- `import-n8n-workflows-live.ps1`
- `n8n-workflow-sync-menu.ps1`
- `validate-n8n-workflows.cjs`
- `sync-n8n-live-exports.cjs`
- `prepare-n8n-live-import.cjs`
- `n8n-portable-workflow.cjs`
- `n8n-credential-metadata.cjs`
- `n8n-workflow-transport.cjs`
- `n8n-workflow-operation-report.cjs`
- `n8n-workflow-identity.cjs`
- `compare-n8n-workflow-credentials.cjs`
- `should-import-n8n-workflow.cjs`
- `_export-n8n-workflows-live.cmd`
- `_import-n8n-workflows-live.cmd`

The live import/export PowerShell helpers support explicit Docker target overrides with `-Container`, `-ContainerName`, `-ContainerId`, `-ComposeProject`, and `-ComposeService`, plus the matching environment variables `N8N_CONTAINER_NAME`, `N8N_CONTAINER_ID`, `N8N_COMPOSE_PROJECT`, and `N8N_COMPOSE_SERVICE`. Without an explicit target, they detect running n8n containers from Docker Compose service output, Compose labels, and safe `n8nio/n8n` image fallback. Multiple detected instances require a valid numeric selection for the current run only and are not persisted.

## Wrapper Working Directory

The `.cmd` wrappers invoke their co-located PowerShell scripts with `%~dp0<name>.ps1` and do not change directory themselves. The PowerShell scripts resolve and set their working directory from their script location.

## Portable Import Contract

Normal operator flow is export canonical workflow JSON and portable logical credential name/type declarations to Git, create matching credentials on the target when reported missing, then rerun the unchanged import command. The helper resolves target IDs internally, rebuilds from canonical Git, applies only dedicated webhook metadata and declared exact resource paths, validates the canonical invariant, imports inactive without a routine confirmation, and verifies the inactive postcondition.

The helper never activates, executes, test-runs, publishes, or restarts n8n. An already-active target is blocked because scheduled activity cannot be guaranteed inactive without a separate restart. `-RequireConfirmation` is compatibility-only menu behavior and is not the default.

Operation receipts are written to `.n8n-local/reports/latest-n8n-workflow-operation.{json,txt}` and bounded 90-day history. The menu's read-only Explain last n8n failure action validates the latest report and states one supported next action.

## Intended Scoped Writes

In a reviewed consumer repo, these helpers may write:

- `n8n-workflows/*.json`
- `n8n-workflows/README.md`
- `n8n-workflows/scripts/**`
- `.tmp/**`
- `.n8n-local/**`

`.tmp/**` and `.n8n-local/**` must stay ignored and uncommitted. They can hold transient prepared payloads, exact private resource bindings, and sanitized reports. Portable logical credential name/type declarations belong under `n8n-workflows/toolkit/` and may be committed.

## Safety Rules

- Do not run live n8n import or export from this toolkit repo.
- Do not run live n8n import/export in CI.
- Do not commit `.tmp/**`, `.n8n-local/**`, live import/export JSON, credential IDs/values, encrypted credential exports, private keys, or `.env` files.
- Do not commit workflow JSON containing credentials, secrets, tokens, cookies, webhook secrets, private environment values, or production execution data. Use placeholder environment variable names only and document required variables separately.
- Do not commit `.n8n/` runtime folders, n8n database files, binary backups, or live execution exports.
- Helper scripts must not print secrets and must not default to destructive live actions.
- Review workflow diffs before committing `n8n-workflows/*.json` in a consumer repo.
- Treat these executable files as helper templates, not trusted runtime code.
