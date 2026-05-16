<!--
Generated from toolkit project exports. Do not edit directly.
Project: n8n.workflow-templates
Source: projects/n8n/workflow-templates/exports/templates/n8n/workflow-policy/README.md
Update the source project export and run the sync/check workflow.
-->
# Workflow Policy Templates

This folder documents policy inputs for reusable n8n workflow validation and sync.

## Included

- `credential-migration-map-example.md`: generic example for local-only credential migration mapping.

## Rules

- Copy examples into a consumer repo only after review.
- Keep actual credential migration maps in ignored `.n8n-local/` if they contain local details.
- Do not commit credential IDs, token values, or binding files.
