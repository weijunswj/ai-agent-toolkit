<!--
Curated AI-facing source.
Project: n8n.workflow-templates
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Workflow Policy Templates

This folder documents policy inputs for reusable n8n workflow validation and sync.

## Included

- `credential-migration-map-example.md`: generic example for local-only credential migration mapping.

## Rules

- Copy examples into a consumer repo only after review.
- Keep actual credential migration maps in ignored `.n8n-local/` if they contain local details.
- Do not commit credential IDs, token values, or binding files.
