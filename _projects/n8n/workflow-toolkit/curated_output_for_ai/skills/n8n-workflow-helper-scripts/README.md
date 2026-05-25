<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Helper Scripts

This skill contains reusable helper-script templates for safe n8n workflow work.

It owns sanitizer helpers, import/export sync helpers, validation, compare, prepare, and workflow sync scripts.

This skill depends on `n8n-agent-rules`. Apply that skill before n8n workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, import/export, validation, credential, webhook ID, activation, execution, repo/live sync, or live n8n work.

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

A generated cross-skill reference is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for copy-paste portability. It is generated from the canonical `development.ai-coding-agent-rules` source and must not be edited directly.
