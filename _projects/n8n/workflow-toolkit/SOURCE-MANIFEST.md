# Source Manifest: n8n Workflow Toolkit

## Preserved In `_main/`

- `README.md`
- `helper-scripts/sanitizer/**`
- `helper-scripts/import-export-sync/**`
- `workflow-templates/**`

## AI-Facing Surfaces

- `skills/n8n-workflow-helper-scripts/` is generated from reviewed curated entrypoints plus exact copied helper scripts from `_main/helper-scripts/**`.
- `skills/n8n-workflow-templates/` is generated from reviewed curated entrypoints plus reviewed workflow JSON templates from `_main/workflow-templates/**`.
- `mcp/projects/n8n-workflow-toolkit.md` is generated from reviewed curated MCP notes.
- Import/export sync helper scripts were rehomed from Secure CI/CD shared-surface ownership into this n8n workflow toolkit project. The older Secure CI/CD `_main/templates/n8n/**` files remain preserved provenance-only material for now.

## Excluded

- Live n8n exports/imports, credential bindings, `.n8n-local/`, `.tmp/`, generated artifacts, and private workflow JSON.
