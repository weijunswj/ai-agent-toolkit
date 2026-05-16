# n8n Sync Helpers

This folder contains review-required helper templates migrated from `weijunswj/ai-cicd-installer`.

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
- `- export-n8n-workflows-live.cmd`
- `- import-n8n-workflows-live.cmd`

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
