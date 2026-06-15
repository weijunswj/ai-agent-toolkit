# Generated Output And Publishing Playbook

Use this for `_projects/**`, `skills/**`, manifests, source locks, generated outputs, sync scripts, source-watch, audit baselines, or source-of-truth changes.

## Source Ownership

- `_projects/**/_main/` preserves source material.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source.
- `skills/**` is generated or published output unless declared `linked`.
- `toolkit.project.json` declares project version, outputs, and write boundaries.
- `SOURCE-LOCK.json` records provenance and source-watch metadata.

Edit source or curated files first. Do not edit generated `skills/**` directly unless the manifest explicitly declares a linked exception.

## Sync And Freshness

Use the narrow sync/check path that matches the touched surface. For project outputs, run:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
```

For managed root/shim instruction outputs, run:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --write
```

## Source-Watch Safety

Source-watch is PR-notification-only. It must not copy upstream files, update pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat a notification PR as approval to change source.

## Audit Boundaries

Update audit baselines only after inspecting exact count movement and confirming it is intentional.
