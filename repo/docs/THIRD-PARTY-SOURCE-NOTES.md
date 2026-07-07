# Third-Party Source Notes

## Google Labs DESIGN.md

The external `google-labs-code/design.md` project is used only as an active upstream-tracked design-contract reference for the UI/UX skill.

The toolkit project `version` in `_projects/design/google-design-md/toolkit.project.json` is the toolkit adaptation version, not an upstream package version. Upstream repo, ref, commit, file pins, attribution requirement, allowlist, and manual-review update policy are tracked in `_projects/design/google-design-md/SOURCE-LOCK.json`.

Reviewed source:

- `google-labs-code/design.md`
- Public GitHub repo, README, `docs/spec.md`, `LICENSE`, and repository tree metadata
- Reviewed date: 2026-07-03

### What Was Used

The toolkit adapts only the design-contract reference concept from:

- `docs/spec.md`

It publishes the Toolkit-local reference at `skills/ui-ux-secure-frontend-design/references/design-md-contract.md`.

### What Was Not Used

This toolkit does not vendor or execute external:

- CLI package code.
- Package manifests as dependencies.
- `npx @google/design.md` commands.
- Examples, generated assets, workflows, lockfiles, remote validators, or package install paths.

License: Apache-2.0. Public attribution is required.

## UI/UX Pro Max

The external `nextlevelbuilder/ui-ux-pro-max-skill` project is used only for the safe local-search subset documented in [_projects/design/ui-ux-pro-max/](../../_projects/design/ui-ux-pro-max/).

The toolkit project `version` in `_projects/design/ui-ux-pro-max/toolkit.project.json` is the toolkit adaptation version, not the upstream third-party version. Upstream repo, ref, commit, file pins, attribution requirement, allowlist, and manual-review update policy are tracked in `_projects/design/ui-ux-pro-max/SOURCE-LOCK.json`.

Reviewed source:

- `nextlevelbuilder/ui-ux-pro-max-skill`
- Public GitHub repo and README/tree
- Reviewed date: 2026-05-16

## What Was Used

The toolkit vendors/adapts only the local-search subset:

- `src/ui-ux-pro-max/scripts/core.py`
- `src/ui-ux-pro-max/scripts/design_system.py`
- Required CSV data under `src/ui-ux-pro-max/data/`

## Update Rules

Scheduled source-watch checks are advisory/manual-review only. Normal third-party source tracking must read active third-party tracking from `SOURCE-LOCK.json`; temporary advisory targets that are not yet source dependencies live in `repo/source-watch/advisory-targets.json` and are reported only when actionable. Active third-party locks require `source_update_policy: "manual_review_required"`, `public_attribution_required: true`, a full 40-character `source_commit`, and `source_blob_sha` pins for exact and adapted copied files. Updates require attribution review, allowlist review, local-only script checks, and full repo validation.

## What Was Not Used

This toolkit does not vendor external:

- CLI scripts.
- Generated templates.
- Assets.
- Screenshots.
- Package metadata.
- Install commands.

Project-owned scripts preserved under `_projects/**/_main/` are source material, not automatically trusted runtime code.
