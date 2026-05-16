# n8n Templates

This area contains reusable n8n helper-template sources, not live workflow exports.

## Folders

- `sync-helpers/`: review-required helper scripts for consumer repos that manage repo/live n8n workflow sync.
- `sanitizer/`: scripts for turning raw workflow exports into safer templates.
- `workflow-policy/`: policy notes and examples for workflow validation and credential migration.

## Intended Scoped Writes

Some helper templates intentionally write local files when copied into a reviewed consumer repo:

- Agent-reviewed n8n sync helpers may update `n8n-workflows/*.json`.
- n8n sync helpers may create ignored `.tmp/**` and `.n8n-local/**`.
- Sanitizer helpers may create ignored `.to-sanitise/**` and `.sanitised/**`.

These writes are local helper behavior, not permission to commit unsafe files. Do not run live n8n import/export in CI.

## Safety

Do not commit:

- `.to-sanitise/`
- `.sanitised/`
- `.n8n-local/`
- `.tmp/`
- `*.live-export.json`
- `*.live-import.json`
- Credential exports or credential binding files.

No product/customer workflow JSON is included in this toolkit.
