# Maintenance Mode

Use maintenance mode when a repo already has local source-of-truth docs, manifests, generated outputs, validation, or audit policy.

## Local Law First

Before editing, read the target repo's local authority files. Common names include:

- Agent instructions.
- Source-of-truth docs.
- Project/module standards.
- Generated-output or sync docs.
- Audit baselines.
- Validation scripts.
- CI workflow docs.

Use this skill as a method, not as a replacement for those files.

## Maintenance Workflow

1. Identify the requested surface change.
2. Find the owning project/module and manifest.
3. Inspect the source file, adapter file, and generated output path.
4. Decide whether the source, curated adapter, manifest, or linked output should change.
5. Make the smallest change in the source of truth.
6. Run deterministic sync.
7. Run the repo's check command for generated freshness.
8. Run targeted audits and tests. Use `validation-strategy.md` for the iteration cadence.
9. Review generated diffs for unrelated churn.
10. Update an audit baseline only after confirming every movement is intentional.

## What Not To Do

- Do not overwrite local repo law with generic templates.
- Do not change validation commands unless the task is specifically about validation.
- Do not edit generated outputs directly when the manifest says they are generated.
- Do not add broad routing through this skill unless the repo maintainers ask for it.
- Do not clean up unrelated audit findings in the same focused change.
- Do not repeat full-suite validation while still iterating when a narrow failing check can isolate the issue.

## When To Ask For Confirmation

Ask before live-system mutation, destructive cleanup, credential changes, deletion, broad rewrites, or production-impacting automation.

For local docs and deterministic generated outputs, proceed when the task is clearly scoped and local rules allow it.
