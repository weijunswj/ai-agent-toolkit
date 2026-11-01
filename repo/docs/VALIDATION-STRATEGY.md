# Validation Strategy

Use validation in two phases: fast targeted local checks before pushing, then the full read-only CI gate for PR and `main` readiness.

Targeted validation is an iteration strategy, not a quality downgrade. Local `npm run validate:all` is not required before every push when CI already runs the full gate.

Release maintenance uses `repo/tests/toolkit-version.test.cjs` and `repo/tests/toolkit-rebump-prs.test.cjs`, `repo/tests/toolkit-rebump-prs-conflicts.test.cjs` and `repo/tests/toolkit-rebump-prs-push.test.cjs`: patch, minor and major intent, repeated main moves, fragment folding, frozen notes, conflict refusals, merge parentage, ordinary pushes and concurrent changes. Re-bump tests use disposable local repositories and a bare remote. They do not qualify computer authentication or the coordinator trigger; real agent UAT covers that route. Every re-bumped head needs fresh CI and full delta G2 review.

## Canonical Merge Gate

For this repo, the canonical full validation command is:

```bash
npm run validate:all
```

The gate has one list: the `Run validation` step of the `validate` job in `.github/workflows/validate.yml`, which runs on every pull request and push to `main`. `npm run validate:all` runs the same commands in the same order from that step (`repo/scripts/run-validation-gate.cjs`), so the local and CI gates cannot drift. In CI the test files run first, in shards on Linux and Windows, and the last command of the step (`run-tests.cjs --verify-ci`) proves from the shard summaries that every shard passed and that each system ran every test file exactly once; a local run has no shards, so that command runs every test file instead (`run-tests.cjs --all`). The `validate` job of the Validate workflow is the CI gate for pull requests and `main`, and is the check to make required in the ruleset.

## Test Shards

`repo/contracts/ci/test-shards.json` splits `repo/tests/*.test.cjs` into named shards per system. Each named shard lists its files; one `rest` shard per system runs every file no other shard names, so a new test file always runs. A `.test.cjs` entry there that would not run fails every runner mode instead of being skipped: a name that does not start with a letter or digit or has characters other than letters, digits, dots, dashes and underscores, or a folder or link with a test name. `durations_seconds` holds the last measured time per file, which orders files longest first inside a shard and lets `node repo/scripts/run-tests.cjs --plan` estimate each shard. `node repo/scripts/refresh-shard-timings.cjs` reads the per-file times from the shard summaries of the latest green Validate run on `main` (each shard job uploads its summary as a `test-summary-<shard>` artifact, kept 7 days) and reports whether a refresh is due: more than 10% of test files without a recorded time, or a system whose slowest shard is estimated over 1.3 times its fastest. It makes no model calls. With `--write` it updates the manifest in the checkout, moving files between the named shards when they are out of balance; with `--open-pr` it does the same on a new branch from `origin/main` and opens a pull request, and only when a trigger crossed. `--run <id>` reads another finished Validate run, such as a pull request's run that measured a new or split test file. A failed shard uploads its summary too, so the `validate` job names the tests that failed instead of reporting every file of that shard as not run; the refresh reads times only from the summaries of shards that passed. Run it by hand or when planning a release.

A test that pins a calendar date passes that same clock to every call that reads the time; otherwise it passes on the day it lands and fails once the real date moves past the pinned one. The `tests-clock-ahead` job proves it on every pull request: `node repo/scripts/run-tests.cjs --clock-ahead` runs every test file that pins a date (an ISO date literal or `Date.UTC(`, in the file or in a `repo/tests` helper it loads) with Node's clock 400 days ahead, through the `repo/scripts/test-clock-offset.cjs` preload in the test processes only. File times and git dates keep the real clock, so a test that compares a file it just wrote with Node's clock sets that file's time from `new Date()` first. The job uploads no summary and never counts toward shard coverage; the `validate` job waits for it, so a failure fails the required check. `--clock-offset-days <n>` moves the clock for a named, `--changed` or `--all` run too, to reproduce a failure locally.

`repo/scripts/check-test-durations.cjs <report.json>...` checks per-file times from a `--summary` or `--report-durations` file against the manifest's `budgets` field; with `--ci` it reads the shard summaries the `validate` job downloaded, and the gate runs it that way, so a test file over its budget fails CI. A raised budget needs a recorded reason. Without a budget, the check only reports the slowest files. This repository allows 120 seconds per file on Linux and Windows, measured in CI; split or speed up a file that goes over. Three files that sat close to that limit (`n8n-workflow-transport` on Linux, `toolkit-governance-gate` and `toolkit-setup-orchestrator-2` on Windows) have a raised 180-second budget until they are split. A budget failure is checked from the shard summaries of that run, so use "Re-run all jobs" to measure again. A local `npm run validate:all` leaves this one check out and says so, because local times are not CI times.

The test jobs in `validate.yml` are pinned word for word by the drift guard (`workflowErrors` in `repo/scripts/ci-test-shards.cjs`, run by `repo/tests/ci-test-shards.test.cjs` and again by `--verify-ci` in CI). Adding or renaming a shard changes the manifest and the matrix together. The guard refuses narrowed file lists, `node --test` filters, `if: false`, masked exit codes, `continue-on-error`, matrix `include`/`exclude` edits and a `validate` job that does not wait for every shard and the clock-ahead job. The guard compares the whole file, from the triggers to the last line, with its pinned text (`workflowText`), so a comment, a quoted or flow-style key, or a workflow-wide `defaults:` or `env:` cannot slip in beside the jobs, and any other edit to the file needs the same edit there. One kind of edit passes without it: a Dependabot update that changes only the commit SHA and `# vX.Y.Z` version comment of a pinned action, with the same action name, a full 40-character lower-case SHA and nothing else on the line. The guard's tests find the pins in the live file instead of naming today's SHAs, and they rerun every drift case with each pinned action updated, so such an update passes the whole test run too. A new major version of `actions/checkout` still needs a hand edit, because a test in `repo/tests/validate-toolkit.test.cjs` requires its major version. Only the commands of the `Run validation` step are read from `validate.yml`, which stays their one list: each must be a plain `node repo/scripts/<name>.cjs` line with simple arguments and no shell syntax, and the summary check stays last. As a second check, the guard also refuses the usual spellings of `set +e`, `|| echo` and a `shell:` key, because a custom shell can drop the `bash -e` that stops a step at its first failing command.

Every run, local or CI, gets its own scratch temp folder: `%USERPROFILE%\t\run-<time>-<random>` by default, or under the `--temp-root` CI passes (the runner temp folder). It is set as `TEMP`, `TMP` and `TMPDIR` for every child process, used in its long form (never an 8.3 short name), and removed when the run finishes, also on failure. The next run removes a folder left by an interrupted run once it is more than a day old. Anything a run must keep, such as a summary or durations report, is written with `--summary` or `--report-durations` to a path outside the run folder before the folder is removed. A temp root at or directly under a drive root is refused.

The whitespace check (`npm run validate:whitespace`, `repo/scripts/check-diff-whitespace.cjs`) compares the whole change with its base: in CI the pull request base or the previous `main` tip (`DIFF_BASE`), locally where the branch left `origin/main`, including uncommitted edits. A plain `git diff --check` sees only uncommitted edits, so on a clean CI checkout it checks nothing.

Do not run `--write` commands in the required validation workflow.

## Other Workflows

None of these is part of the merge gate.

- `.github/workflows/dependency-auto-merge.yml` (Dependency auto-merge): on Dependabot pull requests, turns on GitHub auto-merge, merge commit only, for patch and minor updates once every required check passes, when the programme binding allows it. Major, risky and GitHub Actions updates stay open for the owner. Governed repositories get a copy of this file.
- `.github/workflows/source-watch-plan.yml` (Source Watch Advisory Plan): started by hand; writes the advisory third-party source update plan to the run summary and checks the source locks and Toolkit surfaces. Read-only.
- `.github/workflows/source-watch-pr.yml` (Source Watch PR Notifier): scheduled three times a day on trusted `main`; checks active third-party sources for updates and keeps one review notification pull request open while something is left to review.

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
