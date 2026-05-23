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

## Project Versions

The project manifest owns the toolkit module version:

- `version`: toolkit project module/adaptation version in `MAJOR.MINOR.PATCH` format.
- `version_policy`: currently only `semver`.
- `version_notes`: what the version represents.

Do not use upstream versions, Git tags, package tags, release tags, or per-file versions as substitutes. Do not bump the project version for regenerated outputs when source content and the project contract did not change.

## Source Locks

Source locks record exact, adapted, excluded, or linked provenance. `SOURCE-LOCK.json` owns upstream repo, source ref, locked commit, lifecycle, role, update policy, attribution requirements, allowlisted files, and exact blob pins.

For third-party projects, the toolkit project version is the toolkit adaptation version, not the upstream version. Scheduled source-watch checks must use `SOURCE-LOCK.json` to identify upstream source and exact pins. Active third-party locks require manual review, public attribution, a full 40-character `source_commit`, and `source_blob_sha` pins for exact and adapted copied files.

Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.

## Updates

1. Update source or curated adapter material.
2. Update the manifest.
3. Run sync.
4. Run checks and audits.
5. Update baselines only after review.
