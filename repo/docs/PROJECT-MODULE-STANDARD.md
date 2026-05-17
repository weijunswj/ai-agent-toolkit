# Project Module Standard

Project modules are the source-of-truth layer for reusable toolkit inputs.

```text
_projects/<category>/<project>/
  README.md
  toolkit.project.json
  SOURCE-MANIFEST.md
  SOURCE-LOCK.json
  _main/
    ...actual project files...
  curated_output_for_ai/
    ...optional reviewed AI/toolkit-facing transformations...
  _generated/
    ...optional generated previews...
```

## Folder Roles

- `_projects/` keeps reusable source projects visible near the top of the repo.
- `_main/` preserves actual project/source files with original names and structure where practical.
- `curated_output_for_ai/` is optional. Use it only when a root output needs curation, safety filtering, AI-facing wording, summarisation, or an intentionally adapted variant.
- `_generated/` is optional preview output only and is not source of truth.

Do not use `original/` or `derived/` as standard folder names. Do not create empty curated folders just to satisfy a schema. Do not duplicate root skills, MCP docs, templates, packs, or tools under curated output unless an intermediate curated source is genuinely useful.

## Root Surfaces

These root folders remain obvious for consumers:

- [for_ai/skills/](../skills/) for published instruction-only AI-agent behavior layers.
- [for_ai/mcp/](../mcp/) for published MCP specs and project discovery docs.
- [for_ai/templates/](../templates/) for ready-to-copy template material.
- [for_ai/packs/](../packs/) for approval-gated install/review bundles.
- [for_ai/tools/](../tools/) for optional executable tooling.
- [for_ai/registry/](../registry/) for machine-readable discovery.
- [for_ai/playbooks/](../guides/) for human-friendly quickstarts and canonical guides.
- [repo/docs/](../docs/) for policy, standards, safety, and architecture docs.

Root published surfaces should be generated only by declared recipes, sourced from curated output only when curation is needed, directly maintained as `linked`, or covered by source locks.

## Recipes

`toolkit.project.json` declares how project source relates to root outputs:

- `copy`: root output is copied from `_main/` or optional curated output. Markdown copies get a generated notice by default.
- `concat`: root output is built from multiple declared source files.
- `curated`: root output is generated from `curated_output_for_ai/`.
- `json`: JSON is parsed and pretty-printed deterministically without semantic mutation.
- `linked`: root output is directly maintained and should be reviewed when `_main/` changes.

The sync script never uses AI, never summarises, never executes project scripts, never installs packages, never uses network, and never runs live n8n import/export.

## Source Locks

Each project module has a `SOURCE-LOCK.json` file. Exact-copy entries pin the expected Git blob SHA for preserved files. Adapted or excluded entries must say so explicitly with notes. Root helper/tool surfaces may also be listed with `root_surface_path` when they intentionally mirror or adapt upstream material.

Each lock also declares source lifecycle metadata:

- `source_lifecycle`: `active` or `retired_after_migration`.
- `source_role`: `migration_provenance_only` or `third_party_attribution_source`.
- `source_update_policy`: `none` or `manual_review_required`.
- `public_attribution_required`: boolean.

Retired internal migration sources keep exact-byte provenance but are not watched as active upstreams. Active third-party attribution sources require manual review and public attribution.

Run the local audit without network access:

```powershell
node repo/scripts/audit-project-source-locks.cjs
```

## Updating A Project

1. Update allowlisted source files under `_projects/**/_main/`.
2. Update `SOURCE-LOCK.json` with exact, adapted, or excluded entries.
3. Update root linked surfaces manually when needed.
4. Update `curated_output_for_ai/` only when a reviewed intermediate source is needed.
5. Run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
```

AI may help draft or review root skills, MCP docs, and curated output, but deterministic scripts publish and check declared outputs.
