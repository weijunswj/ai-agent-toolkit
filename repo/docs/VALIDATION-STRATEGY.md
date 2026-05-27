# Validation Strategy

Use validation in two phases: fast targeted local checks before pushing, then the full read-only CI gate for PR and `main` readiness.

Targeted validation is an iteration strategy, not a quality downgrade. Local `npm run validate:all` is not required before every push when CI already runs the full gate.

## Canonical Merge Gate

For this repo, the canonical full validation command is:

```bash
npm run validate:all
```

The read-only PR and `main` validation workflow must call that command directly instead of duplicating a partial checklist. `validate:all` is the required CI and `main` merge gate.

Do not run `--write` commands in the required validation workflow.

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

Before pushing, run the smallest relevant targeted checks that cover the edited files and any generated outputs.

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

## Auto-Sync Is Convenience Only

Generated-surface auto-sync is optional convenience writeback for narrow deterministic generated-output updates. It is not the merge gate and must not replace `npm run validate:all`.

Auto-sync should skip cleanly when a PR includes `_projects/**/_main/**` source or provenance changes. In that case, the author or Codex must commit any needed generated outputs, source-lock or provenance updates, and audit baseline updates before the PR passes validation.

CI should catch missed `_main` follow-up work by failing read-only validation, not by silently mutating source/provenance PRs.

## Local Full Validation

Run local `npm run validate:all` when the change is broad or risky, touches workflow, sync, generator, packaging, or security-sensitive behavior, or when CI fails and local reproduction is needed:

```bash
npm run validate:all
git diff --check
```

For narrow docs, template, or generated-surface follow-ups, targeted local checks plus the read-only CI full gate are the expected workflow.

## Failure Loop Rule

Do not run `npm run validate:all` repeatedly while still iterating.

If full validation fails, inspect the failing section and run the narrow relevant command before retrying full validation. Fix the specific issue, then retry the full suite once.

## Reporting

Report targeted checks, any local full validation that was run, and the CI gate expectation. If a local full check is skipped, say why and identify the remaining risk.
