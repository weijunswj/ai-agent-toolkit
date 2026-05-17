# Source Of Truth

This repo owns reusable AI-agent toolkit assets.

The compact shared contract lives in [source-of-truth-contract.md](partials/source-of-truth-contract.md) and is synced into the main entry points with `node repo/scripts/sync-repo-doc-contract.cjs --write`.

## Toolkit-Owned

- Reusable skills.
- Reusable guides.
- Agent-rule templates.
- MCP config templates.
- n8n helper-template sources.
- CI/CD installer guides and templates.
- Optional local-only tools.
- Pack manifests.
- Registry metadata.
- MCP design specs.

## Product-Owned

Product repos own:

- Product code.
- Product workflows.
- Product configs.
- Customer data.
- Live n8n workflow exports.
- Local helper outputs such as `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**`.
- Production deployment settings.

Do not move product-owned assets into this toolkit.

## Registries

The JSON registries under `for_ai/registry/` are the published discovery surface. Generated registries should be refreshed from project manifests with `node repo/scripts/sync-toolkit-projects.cjs --write`.

## Guarded Generated Auto-Sync

The `Auto-sync generated toolkit surfaces` workflow is only a deterministic generated-output writeback helper for same-repo PR branches targeting `main`.

- Fork PRs are never written to.
- `main` is never written to.
- The workflow only republishes declared generated/synced outputs such as `README.md`, `AGENTS.md`, and `for_ai/**`.
- It does not update sources, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or address skill portability.
- If eligible source/routing/contract edits are mixed with forbidden workflow, maintenance-script, or preserved-source path changes, the workflow fails or safely skips instead of pushing.

## Packs

Pack manifests under [for_ai/packs](../../for_ai/packs/) are the published installable bundle surface. For internal generated packs, author the project-owned source under `_projects/**/curated_output_for_ai/packs/` and run sync.

## Retired Source Provenance

The toolkit is now the canonical source of truth. Historical provenance for retired internal source repos lives in [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md); permanent docs should link to toolkit-owned paths or third-party attribution notes.
