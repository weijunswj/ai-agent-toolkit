# Canonical Surface Maintenance Playbook

Use this for `skills/**`, `repo/contracts/**`, source locks, retained synchronizers, source-watch, audit baselines, or source-of-truth changes.

## Source Ownership

- `skills/**` contains complete copyable skill material.
- `repo/contracts/**` contains machine contracts, fixtures, templates, and reviewed inputs.
- `repo/source-watch/provenance/**/SOURCE-LOCK.json` records provenance and source-watch metadata.

Edit the direct canonical surface. Do not create a second source or publishing tree.

## Sync And Freshness

Use the narrow sync/check path that matches the touched surface. For managed root blocks and shims, run:

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-agent-instruction-shims.cjs --check
```

For managed root/shim instruction outputs, run:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --write
```

## Source-Watch Safety

Source-watch is PR-notification-only. It must not copy upstream files, update pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat a notification PR as approval to change source.

## Audit Boundaries

Update audit baselines only after inspecting exact count movement and confirming it is intentional.
