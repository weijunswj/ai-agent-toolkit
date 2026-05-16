# n8n Templates

This area contains reusable n8n helper-template sources, not live workflow exports.

## Folders

- `sync-helpers/`: review-required helper scripts for consumer repos that manage repo/live n8n workflow sync.
- `sanitizer/`: scripts for turning raw workflow exports into safer templates.
- `workflow-policy/`: policy notes and examples for workflow validation and credential migration.

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
