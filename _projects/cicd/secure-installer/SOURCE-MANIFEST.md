# Source Manifest: Secure CI/CD Installer

## Preserved In `_main/`

- `README.md`
- `docs/**`
- `templates/**`
- `tests/**`

## Root Surfaces

- Root skill, MCP doc, guide, template docs, and pack are directly maintained and declared as `linked`.
- `templates/n8n/sync-helpers/validate-n8n-workflows.cjs` is copied from `_main/templates/n8n/`.
- Toolkit-adapted root n8n sync helpers are linked and source-locked.

## Excluded

- Secrets, deployment credentials, private CI variables, generated package artifacts, and product-specific pipeline state.
