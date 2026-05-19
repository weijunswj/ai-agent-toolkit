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
- Toolkit-adapted n8n helper scripts remain preserved under `_main/templates/n8n/` as Secure CI/CD migration provenance from `weijunswj/ai-cicd-installer`.
- Published n8n helper-script outputs are now owned by `n8n.workflow-toolkit` and generated from `_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync/**`.

## Excluded

- Secrets, deployment credentials, private CI variables, generated package artifacts, and product-specific pipeline state.
