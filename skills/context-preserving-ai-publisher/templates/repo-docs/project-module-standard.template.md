<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/templates/repo-docs/project-module-standard.template.md
Update the project source and run sync.
-->
# Project Module Standard

Project modules preserve source material and declare how published surfaces are generated.

```text
<source-root>/<category>/<project>/
  README.md
  SOURCE-MANIFEST.md
  SOURCE-LOCK.json
  <manifest>.json
  _main/
  curated_output_for_ai/
```

## Folder Roles

- `_main/`: full source material and provenance.
- `curated_output_for_ai/`: reviewed routers, indexes, wrappers, metadata, and shims.
- Published surface folders: generated outputs used by agents.

## Recipes

- `copy`: exact file or folder copy.
- `extract`: exact marked section.
- `concat`: deterministic composition.
- `curated`: reviewed adapter material.
- `json`: deterministic JSON formatting.
- `linked`: directly maintained output with a documented reason.

## Source Locks

Source locks record exact, adapted, excluded, or linked provenance. Exact entries should pin a stable file hash when the repo supports it.

## Updates

1. Update source or curated adapter material.
2. Update the manifest.
3. Run sync.
4. Run checks and audits.
5. Update baselines only after review.
