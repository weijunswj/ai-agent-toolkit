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

## Included Helpers

- `export-n8n-workflows-live.ps1`
- `import-n8n-workflows-live.ps1`
- `n8n-workflow-sync-menu.ps1`
- `validate-n8n-workflows.cjs`
- `sync-n8n-live-exports.cjs`
- `prepare-n8n-live-import.cjs`
- `compare-n8n-workflow-credentials.cjs`
- `should-import-n8n-workflow.cjs`
- `_export-n8n-workflows-live.cmd`
- `_import-n8n-workflows-live.cmd`

## Wrapper Working Directory

The `.cmd` wrappers invoke their co-located PowerShell scripts with `%~dp0<name>.ps1` and do not change directory themselves. The PowerShell scripts resolve and set their working directory from their script location.

## Import Restart Warnings

`import-n8n-workflows-live.ps1` may print restart warnings when active or scheduled live workflows were touched. For Docker-backed n8n, pass `-RestartContainerAfterImport` to restart the configured container automatically after a successful import when those warnings exist:

```powershell
.\import-n8n-workflows-live.ps1 -WorkflowDir n8n-workflows -RestartContainerAfterImport
```

The direct `_import-n8n-workflows-live.cmd` wrapper prompts whether to enable that switch before each run. The helper never restarts during `-DryRun`, and it does not restart when no imported workflow needs the restart warning.

## Intended Scoped Writes

In a reviewed consumer repo, these helpers may write:

- `n8n-workflows/*.json`
- `.tmp/**`
- `.n8n-local/**`

`.tmp/**` and `.n8n-local/**` must stay ignored and uncommitted. They can hold transient live export/import payloads and local credential-binding metadata.

## Safety Rules

- Do not run live n8n import or export from this toolkit repo.
- Do not run live n8n import/export in CI.
- Do not commit `.tmp/**`, `.n8n-local/**`, live import/export JSON, credentials, credential bindings, private keys, or `.env` files.
- Review workflow diffs before committing `n8n-workflows/*.json` in a consumer repo.
- Treat these executable files as helper templates, not trusted runtime code.
