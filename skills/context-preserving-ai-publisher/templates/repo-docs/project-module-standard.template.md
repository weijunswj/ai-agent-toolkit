# Canonical Surface Standard

Canonical surfaces preserve complete working material and keep ownership explicit.

```text
skills/<skill-name>/
repo/contracts/<contract-name>/
repo/source-watch/provenance/<source-name>/SOURCE-LOCK.json
```

## Folder Roles

- `skills/<skill-name>/`: complete copyable skill material.
- `repo/contracts/<contract-name>/`: schemas, policies, fixtures, templates, and reviewed agent-rule inputs.
- `repo/source-watch/provenance/`: active third-party source locks and attribution records.

## Recipes

- Keep the canonical surface complete enough for normal use without another source tree.
- Keep short routing or adapter material beside the surface that owns it.
- Use deterministic synchronizers only for managed root blocks and shims.

## Package Versions

The canonical Toolkit package contract owns the plugin/module version:

- `repo/contracts/toolkit-local-bridge/version.json` stores the Toolkit package version in `MAJOR.MINOR.PATCH` format.
- Version notes explain the adaptation or package change represented.

Do not use upstream versions, Git tags, package tags, release tags, or per-file versions as substitutes.

## Source Locks

Source locks record exact, adapted, excluded, or linked provenance. `SOURCE-LOCK.json` owns upstream repo, source ref, locked commit, lifecycle, role, update policy, attribution requirements, allowlisted files, and exact blob pins.

For third-party sources, the Toolkit package version is the Toolkit adaptation version, not the upstream version. Scheduled source-watch checks must use `repo/source-watch/provenance/**/SOURCE-LOCK.json` to identify upstream source and exact pins. Active third-party locks require manual review, public attribution, a full 40-character `source_commit`, and `source_blob_sha` pins for exact and adapted copied files.

Scheduled source-watch is PR-notification-only. It may compare active SOURCE-LOCK pins and actionable advisory targets with upstream GitHub commits, then open or refresh a stable review PR. It must not copy upstream files, change SOURCE-LOCK/advisory records, execute upstream code, auto-merge, push to main, run live n8n actions, or treat notification as approval. Real updates require a separate human-approved PR.

## Updates

1. Update the owning canonical surface.
2. Update provenance or routing records when required.
3. Run retained synchronizer checks.
4. Run checks and audits.
5. Update baselines only after review.
