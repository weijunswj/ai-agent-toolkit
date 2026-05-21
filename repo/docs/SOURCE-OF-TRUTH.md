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
- MCP-ready registry metadata.
- MCP design/spec docs.

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

The JSON registries under `mcp/registry/` are the published MCP-ready registry discovery surface. Generated registries should be refreshed from project manifests with `node repo/scripts/sync-toolkit-projects.cjs --write`.

## Guarded Generated Auto-Sync

The `Auto-sync generated toolkit surfaces` workflow is only a deterministic generated-output writeback helper. It is optional convenience, not the merge gate. The required merge gate is the normal read-only validation workflow running `npm run validate:all`.

The privileged workflow definition runs from the base/default branch, then writes only to eligible same-repo PR branches targeting `main`.

- Fork PRs are never written to.
- `main` is never written to.
- The workflow only republishes declared generated/synced outputs such as `README.md`, `AGENTS.md`, `skills/**`, `mcp/**`, and the source-side agent-rule templates generated from declared agent-rule partials.
- It does not update other sources, run source-watch writeback, run live n8n, touch product repos, generate curated content from `_main`, or address skill portability.
- Because the workflow is privileged, it does not run generated test suites, PR-controlled generated executable code, or full repo validation against raw PR heads; full validation remains covered by normal read-only CI.
- The privileged static checks are limited to generated-surface freshness checks and git diff checks before committing generated output, which avoids blocking otherwise valid behind-main PR branches.
- The workflow only runs deterministic generation, sync, check, or validator scripts from the protected base revision. The PR checkout is treated as data and passed to those scripts through an explicit workspace target.
- The workflow stages and snapshots generated output after sync, then rechecks the index/workspace before commit so validation cannot add files to the writeback diff.
- The workflow pins the PR checkout to the event head SHA, refuses stale queued runs if the PR head changed, verifies the remote PR branch before pushing, and never force pushes.
- If a PR includes `_projects/**/_main/**` source/provenance changes other than declared agent-rule partial inputs and generated source-side agent-rule templates, auto-sync skips successfully without checking out, writing, committing, or pushing. The author or Codex must commit any required generated outputs, source-lock/provenance updates, and audit baseline updates, then pass `npm run validate:all`.
- If a writeback-eligible PR is mixed with forbidden workflow, maintenance-script, test, docs, package, lockfile, or other unsafe paths, the workflow fails instead of pushing.

## Skill-Local Packs

Pack manifests are not a first-class root surface. When a pack is still useful as a review checklist, keep it inside the related skill folder under `skills/<skill-name>/packs/`. For internal generated packs, author the project-owned source under `_projects/**/curated_output_for_ai/packs/` and run sync.

## Retired Source Provenance

The toolkit is now the canonical source of truth. Historical provenance for retired internal source repos lives in [Retired Source Provenance](RETIRED-SOURCE-PROVENANCE.md); permanent docs should link to toolkit-owned paths or third-party attribution notes.
