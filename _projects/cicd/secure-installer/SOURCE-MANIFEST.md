# Source Manifest: Secure CI/CD Installer

## Preserved In `_main/`

- `README.md`
- `docs/**`
- `templates/**`
- `tests/**`

## AI-Facing Surfaces

- AI-facing skill, MCP doc, playbook, template docs, and pack are directly maintained and declared as `linked`.
- `for_ai/templates/n8n/sync-helpers/validate-n8n-workflows.cjs` is copied from `_main/templates/n8n/`.
- Toolkit-adapted AI-facing n8n sync helpers are linked and source-locked.

## Excluded

- Secrets, deployment credentials, private CI variables, generated package artifacts, and product-specific pipeline state.
