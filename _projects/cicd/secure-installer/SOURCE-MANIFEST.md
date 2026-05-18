# Source Manifest: Secure CI/CD Installer

## Preserved In `_main/`

- `README.md`
- `docs/**`
- `templates/**`
- `tests/**`

## AI-Facing Surfaces

- AI-facing skill, MCP doc, short overview/safety wrapper, template docs, and pack are generated from `curated_output_for_ai/`.
- The AI-facing Secure CI/CD prompt is extracted exactly from the preserved `_main/README.md` prompt section.
- Reviewed AI-facing status, source-update policy, GitHub Actions template index, and Secure CI/CD pack README surfaces are generated from `curated_output_for_ai/`:
  - `curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md`
  - `curated_output_for_ai/templates/cicd/safe-source-update-policy.md`
  - `curated_output_for_ai/templates/github-actions/README.md`
  - `curated_output_for_ai/packs/secure-cicd/README.md`
- Toolkit-adapted export, import, and validation helpers are copied from `_main/templates/n8n/`.
- Remaining toolkit-adapted AI-facing n8n sync helpers are linked and source-locked.

## Excluded

- Secrets, deployment credentials, private CI variables, generated package artifacts, and product-specific pipeline state.
