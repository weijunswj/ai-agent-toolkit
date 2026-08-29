
# n8n Workflow Helper Scripts

This skill contains reusable helper-script templates for safe n8n workflow work.

It owns sanitizer helpers, import/export sync helpers, validation, compare, prepare, and workflow sync scripts.

This product depends on `n8n-safety-router`. Apply that product before [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill use, n8n workflow JSON, official n8n MCP, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n work.

## What It Covers

- Sanitizing raw workflow exports.
- Validating workflow JSON.
- Syncing reviewed live exports into consumer repo workflow files.
- Preparing reviewed workflow files for live import.
- Comparing credential bindings safely.
- Keeping local helper outputs ignored and uncommitted.

## What It Does Not Include

- Product workflow JSON.
- Credential exports.
- Committed credential binding files.
- Live import/export payloads.
- `.env`, committed `.tmp/**`, or committed `.n8n-local/**`.

## Included Template Folders

- [Sanitizer helpers](templates/helper-scripts/sanitizer/)
- [Import/export sync helpers](templates/helper-scripts/import-export-sync/)

Review these helpers before copying them into a consumer repo.

A generated cross-product reference is available at [references/n8n-safety-rules.md](references/n8n-safety-rules.md) for copy-paste portability. It is generated from `repo/contracts/agent-rules/n8n-safety-rules.md` and must not be edited directly.
