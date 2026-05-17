<!--
AI-facing toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: n8n.workflow-templates
Review the related _projects/**/_main source when updating.
-->
# Workflow Policy Templates

This folder documents policy inputs for reusable n8n workflow validation and sync.

## Included

- `credential-migration-map-example.md`: generic example for local-only credential migration mapping.

## Rules

- Copy examples into a consumer repo only after review.
- Keep actual credential migration maps in ignored `.n8n-local/` if they contain local details.
- Do not commit credential IDs, token values, or binding files.
