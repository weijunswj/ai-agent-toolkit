# n8n Workflow Sync

This skill helps AI agents handle reusable n8n workflow sync and template hygiene without leaking credentials or product data.

It is generic, credential-free, and product-neutral.

## What It Covers

- Safe repo/live workflow sync planning.
- Credential binding safety.
- Template sanitation.
- Inactive workflow template checks.
- Import/export review before any live action.

## What It Does Not Include

- Live workflow JSON from product repos.
- Credential exports.
- Credential binding files.
- `.env`, `.n8n-local/`, or `.tmp/`.
- Product-specific node names or customer data.
- Runtime scripts inside the skill folder.

## Related Toolkit Templates

- `templates/n8n/sync-helpers/`
- `templates/n8n/sanitizer/`
- `templates/n8n/workflow-policy/`
