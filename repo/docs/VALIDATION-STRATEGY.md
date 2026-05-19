# Validation Strategy

Use validation in two phases: fast targeted checks while editing, then full final validation before reporting PR-ready completion.

Targeted validation is an iteration strategy, not a quality downgrade. Final full validation remains mandatory before reporting PR-ready completion.

## Fast Targeted Checks

Use narrow checks while actively editing so failures are easy to localise:

```bash
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/audit-project-source-locks.cjs
npm run audit:surfaces
npm run audit:surfaces:check
node --test repo/tests/<specific-test-file>.test.cjs
git diff --check
```

Pick the smallest command that checks the thing you changed.

## Surface And Audit Checks

Run surface and audit checks after changing:

- `_projects/**/toolkit.project.json`
- `_projects/**/curated_output_for_ai/**`
- `skills/**`
- `mcp/**`
- audit scripts
- audit baselines
- generated registries

For generated surfaces, run sync first, then check freshness and audit movement.

## Full Final Validation

Before a PR-ready summary, run:

```bash
npm run validate:all
git diff --check
```

Do not remove or weaken this final validation requirement.

## Failure Loop Rule

Do not run `npm run validate:all` repeatedly while still iterating.

If full validation fails, inspect the failing section and run the narrow relevant command before retrying full validation. Fix the specific issue, then retry the full suite once.

## Reporting

Report both targeted checks and final validation. If validation is skipped or cannot run, say why and identify the remaining risk.
