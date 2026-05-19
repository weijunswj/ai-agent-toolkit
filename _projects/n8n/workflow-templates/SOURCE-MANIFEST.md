# Source Manifest: n8n Workflow Templates

## Preserved In `_main/`

- `README.md`
- `scripts/**`
- `templates/**`

## AI-Facing Surfaces

- AI-facing skill, OpenAI agent metadata, MCP doc, workflow-sync overview/safety wrapper, short workflow-sync references, sanitizer docs, workflow policy examples, workflow policy index, and pack files are generated from `curated_output_for_ai/`.
- Toolkit-adapted AI-facing sanitizer scripts are linked and source-locked.
- `skills/n8n-workflow-sync/templates/sync-helpers/` is part of the n8n workflow sync surface, but its helper source provenance remains in `cicd.secure-installer` as declared shared-surface outputs from the retired `weijunswj/ai-cicd-installer` source.

## Excluded

- Live n8n exports/imports, credential bindings, `.n8n-local/`, `.tmp/`, generated artifacts, and private workflow JSON.
