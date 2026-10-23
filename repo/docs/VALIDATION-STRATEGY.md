# Validation Strategy

Use validation in two phases: fast targeted local checks before pushing, then the full read-only CI gate for PR and `main` readiness.

Targeted validation is an iteration strategy, not a quality downgrade. Local `npm run validate:all` is not required before every push when CI already runs the full gate.

## Canonical Merge Gate

For this repo, the canonical full validation command is:

```bash
npm run validate:all
```

The gate has one list: the `Run validation` step of the `validate` job in `.github/workflows/validate.yml`, which runs on every pull request and push to `main`. `npm run validate:all` runs the same commands in the same order from that step (`repo/scripts/run-validation-gate.cjs`), so the local and CI gates cannot drift. In CI the test files run first, in shards on Linux and Windows, and the last command of the step (`run-tests.cjs --verify-ci`) proves from the shard summaries that every shard passed and that each system ran every test file exactly once; a local run has no shards, so that command runs every test file instead (`run-tests.cjs --all`). The workflow keeps the commands literal because the trusted-CI producer map (`repo/contracts/trusted-ci-repository-protection/candidate-producer-map.n6.json`) binds them, the `validate` job name and the step number (6). Its `approved_source_blob_sha` is the Git blob of the whole `.github/workflows/validate.yml` file, so any edit to that file, not only to this step, needs the new blob (`git rev-parse HEAD:.github/workflows/validate.yml` after committing the edit) written there in the same change. The `validate` job of the Validate workflow is the CI gate for pull requests and `main`, and is the check to make required in the ruleset.

## Test Shards

`repo/contracts/ci/test-shards.json` splits `repo/tests/*.test.cjs` into named shards per system. Each named shard lists its files; one `rest` shard per system runs every file no other shard names, so a new test file always runs. `durations_seconds` holds the last measured time per file, which orders files longest first inside a shard and lets `node repo/scripts/run-tests.cjs --plan` estimate each shard. Refresh it from a CI or local run with `--report-durations <file>`, and rebalance the named shards when one shard sets the critical path.

`repo/scripts/check-test-durations.cjs <report.json>...` checks per-file times from a `--summary` or `--report-durations` file against the manifest's `budgets` field. A raised budget needs a recorded reason. Without a budget, the check only reports the slowest files. This repository has not set a budget yet.

The test jobs in `validate.yml` are pinned word for word by the drift guard (`workflowErrors` in `repo/scripts/ci-test-shards.cjs`, run by `repo/tests/ci-test-shards.test.cjs` and again by `--verify-ci` in CI). Adding or renaming a shard changes the manifest and the matrix together. The guard refuses narrowed file lists, `node --test` filters, `if: false`, masked exit codes, `continue-on-error`, matrix `include`/`exclude` edits and a `validate` job that does not wait for every shard.

Every run, local or CI, gets its own scratch temp folder: `%USERPROFILE%\t\run-<time>-<random>` by default, or under the `--temp-root` CI passes (the runner temp folder). It is set as `TEMP`, `TMP` and `TMPDIR` for every child process, used in its long form (never an 8.3 short name), and removed when the run finishes, also on failure. The next run removes a folder left by an interrupted run once it is more than a day old. Anything a run must keep, such as a summary or durations report, is written with `--summary` or `--report-durations` to a path outside the run folder before the folder is removed. A temp root at or directly under a drive root is refused.

The whitespace check (`npm run validate:whitespace`, `repo/scripts/check-diff-whitespace.cjs`) compares the whole change with its base: in CI the pull request base or the previous `main` tip (`DIFF_BASE`), locally where the branch left `origin/main`, including uncommitted edits. A plain `git diff --check` sees only uncommitted edits, so on a clean CI checkout it checks nothing.

Do not run `--write` commands in the required validation workflow.

## Fast Targeted Checks

Use narrow checks while actively editing so failures are easy to localise:

```bash
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/audit-project-source-locks.cjs
npm run audit:surfaces
npm run audit:surfaces:check
node repo/scripts/run-tests.cjs repo/tests/<specific-test-file>.test.cjs
npm run test:changed
git diff --check
```

Pick the smallest command that checks the thing you changed. `npm run test:changed` runs the test files a change affects: changed test files, and test files that name a changed file.

Before pushing, run the smallest relevant targeted checks that cover the edited files and any generated outputs.

## Surface And Audit Checks

Run surface and audit checks after changing:

- `skills/**`
- `repo/contracts/**`
- `repo/source-watch/provenance/**`
- audit scripts
- audit baselines
- generated registries

For managed root contracts or instruction shims, run the retained synchronizer first, then check freshness and audit movement.

## Auto-Sync Is Convenience Only

There is no generic generated-surface auto-sync or writeback lane. The retained synchronizers are narrow: `sync-repo-doc-contract.cjs` maintains the managed source-of-truth block, and `sync-agent-instruction-shims.cjs` maintains root instruction shims plus exactly four portable n8n safety derivatives. Neither publishes Toolkit skills or project outputs, and neither is a substitute for `npm run validate:all`.

Canonical skill, contract, provenance, and audit-baseline changes are reviewed directly at their canonical paths in the PR. No generic Toolkit sync command exists.

CI should catch missed direct-canonical updates with read-only validation, not by silently mutating source or provenance.

## Local Full Validation

Run local `npm run validate:all` when the change is broad or risky, touches workflow, sync, generator, packaging, or security-sensitive behavior, or when CI fails and local reproduction is needed:

```bash
npm run validate:all
git diff --check
```

For narrow docs, template, or retained n8n-safety-derivative follow-ups, targeted local checks plus the read-only CI full gate are the expected workflow.

## Failure Loop Rule

Do not run `npm run validate:all` repeatedly while still iterating.

If full validation fails, inspect the failing section and run the narrow relevant command before retrying full validation. Fix the specific issue, then retry the full suite once.

## Reporting

Report targeted checks, any local full validation that was run, and the CI gate expectation. If a local full check is skipped, say why and identify the remaining risk.
