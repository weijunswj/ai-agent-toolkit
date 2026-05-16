# Workflow Sync

Source-derived from `weijunswj/ai-cicd-installer` n8n helper scripts and `weijunswj/n8n-workflow-templates` sanitizer docs.

## Goal

Keep repo workflow templates reusable while avoiding live-only state, credentials, credential bindings, and accidental product data.

## Safe Flow

1. Export live workflows into an ignored scratch location in the consumer repo.
2. Strip live-only fields, credentials, webhook IDs, static data, tags unless intentionally preserved, and pin data.
3. Keep repo workflow JSON inactive.
4. Store local credential binding metadata only in ignored `.n8n-local/`.
5. Review the diff before import.
6. Prepare live import payloads in ignored `.tmp/`.
7. Run live import only after explicit confirmation in the consumer repo.

The helper templates intentionally support scoped writes in consumer repos:

- `n8n-workflows/*.json` for reviewed workflow source updates.
- `.tmp/**` for transient export/import payloads.
- `.n8n-local/**` for local credential-binding metadata.

Never run live import/export in CI, and never commit `.tmp/**`, `.n8n-local/**`, live export/import files, or credential binding files.

## Toolkit Templates

Use `templates/n8n/sync-helpers/` as review-required template assets. Copy them into a consumer repo only after reviewing the target workflow policy.

Do not run those helper scripts from this toolkit repo.
