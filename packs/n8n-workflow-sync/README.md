# n8n Workflow Sync Pack

Collects the n8n workflow sync skill, guides, sanitizer templates, sync-helper templates, and workflow policy notes.

Review `pack.json` before use.

This pack preserves the source helpers' intended scoped writes when copied into a reviewed consumer repo:

- `n8n-workflows/*.json`
- ignored `.tmp/**`
- ignored `.n8n-local/**`
- ignored `.to-sanitise/**`
- ignored `.sanitised/**`

Do not run live n8n import/export in CI, and do not commit local helper output folders or live import/export files.
