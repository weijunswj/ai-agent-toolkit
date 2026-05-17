<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-templates
Source: _projects/n8n/workflow-templates/curated_output_for_ai/templates/n8n/workflow-policy/README.md
Update the curated output and run sync.
-->
# Workflow Policy Templates

This folder documents policy inputs for reusable n8n workflow validation and sync.

## Included

- `credential-migration-map-example.md`: generic example for local-only credential migration mapping.

## Rules

- Copy examples into a consumer repo only after review.
- Keep actual credential migration maps in ignored `.n8n-local/` if they contain local details.
- Do not commit credential IDs, token values, or binding files.
