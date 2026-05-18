# Source Manifest: Secure CI/CD Installer

## Preserved In `_main/`

- `README.md`
- `docs/**`
- `templates/**`
- `tests/**`

## AI-Facing Surfaces

- AI-facing skill, MCP doc, short overview/safety wrapper, template docs, and pack are generated from `curated_output_for_ai/`.
- The AI-facing Secure CI/CD prompt is extracted exactly from the preserved `_main/README.md` prompt section.
- Toolkit-adapted export, import, and validation helpers are copied from `_main/templates/n8n/`.
- Remaining toolkit-adapted AI-facing n8n sync helpers are linked and source-locked.

## Excluded

- Secrets, deployment credentials, private CI variables, generated package artifacts, and product-specific pipeline state.
