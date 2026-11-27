# Fast Tests And Sharding

Use when tests or CI got slow, or when adding a test runner, test shards or CI test jobs. Speed must never cost coverage: never skip, sample or delete a test to go faster.

## Measure First

- Time each test file on every supported system, the whole suite as CI runs it, and the slowest single tests. Put before and after numbers (files, tests, skipped, time) in the PR; any drop in tests blocks.
- Declare a per-file time budget once measured, and use a small check that reads the per-file times of a run and fails any file over its budget. Raise one file's budget only with a recorded reason.
- Prefer caching or path filters only when the measurement shows they save real time and the same checks still run.
- When a change touches CI or adds a package, language or test folder, run the `secure-ci-cd` CI check-up with `--base` and fix the real gaps it lists in the same PR.

## Make Slow Files Fast

- Tests inside one file run one after another, so the slowest file sets the floor. Fix it first.
- Run a file's tests concurrently only when each test owns its temp folder and removes it when it ends, and none touches shared `process.env`, the working directory, module state or a real user folder. Otherwise split the file by area.
- Replace repeated expensive setup with one template per file (a fixture repo or workspace copied or cloned per case), and call code in process instead of spawning it when the same path is covered.
- Accept a converted file only after several consecutive green runs on every system with identical test counts.

## Long Runs

- Before a long or background command, note its usual time (CI timings, a recent run or the file's budget), then check progress early: at about a quarter of that time, or 15 minutes, whichever comes first.
- When a test, check or build is far over (about twice its usual time) or its rate keeps falling, stop it and rerun the cheapest plain form that still proves the point; never wait open-ended. Say what you stopped and why. An install, migration or deploy stopped halfway can leave a partial state: report how far over it is and ask before stopping it.
- Run the narrowest check that proves the point: one file or one test name before the whole suite.
- When you stop a run, stop its whole process tree, not just the parent. On Windows, follow the orphan cleanup in `windows-local-dev-services`.
- Capture and logging wrappers must cost the same per write however long the run is: open the log once and stream to it, or batch writes; never reopen, re-read or rewrite one growing file per test. For big suites, keep only failures and the summary.

## Shard From One Manifest

A generated weekly refresh PR is a candidate. Its review route is the scripted carry (gate rules): the merge train finder boards it with no G2 only while it stays a manifest-only redistribution from the shard bot's branch (measured times and the files each named shard lists; budgets and every shard unchanged) and its required checks are green on Linux and Windows. Anything more needs the full gates: G0, a fresh G1 and a full G2. The shard manifest is RISKY. Owner UAT is NOT_REQUIRED for manifest-only redistribution because both CI systems exercise the entire changed surface. Budget or generator changes need their own impact assessment.

- One manifest lists named shards per system and one `rest` shard per system that takes every file no other shard names, so new files always run.
- The runner refuses an unknown or empty shard and fails when a file does not load. CI and local runs read the same manifest.
- One final job waits for every shard, runs even when one failed, and passes only when every shard succeeded and the shard summaries cover plain test discovery exactly once per system, with at least one test per file and no failure or cancellation. Make that job the required check.
- A drift guard pins the exact test step text and matrix, and its own test shows it rejects narrowed paths, name filters, `if: false`, `; exit 0` or `|| true`, `continue-on-error`, matrix `include`/`exclude` edits and a runner that ignores its shard. Compare the whole workflow file with the pinned text, not job by job, because a YAML comment, a quoted key or a workflow-wide default can sit outside what a job parser sees. Leave only the gate command list free and allow only plain script commands in it, so a custom `shell:`, `set +e` or `|| echo` cannot hide a failing check. So that Dependabot action updates pass on their own, also accept a pinned `uses:` line whose action stays the same and whose only change is a new full commit SHA and version comment, and have the guard's tests find the pins in the live file rather than naming today's SHAs, so the update passes the tests too.

## Arrange Shards In This Repository's CI

The `secure-ci-cd` CI check-up only measures and flags: `speed.shards` names a test job with no matrix that took 10 minutes or more (the `unsharded_test_job_seconds` budget), with a suggested shard count and the tracked test files; `speed.shards-lopsided` names matrix legs of one split far apart. The repository's controller arranges the shards in the repository's own CI, for any stack:

1. **Decide:** start from the finding. If sharding cannot pay (setup takes most of the job, or one file is most of the time), add an ignore entry with the reason to `.github/ci-checkup.json` and stop.
2. **Measure:** time each test file once on CI with the stack's own runner (for example `pytest --durations=0`, `python -m unittest` timed per file, `node --test` reporter output or `go test -json`) and keep the times in a small JSON file in the repository.
3. **Split tracked files:** a small repository-owned script lists tracked test files (`git ls-files '<test pattern>'`, never a folder walk), deals them into N legs by measured time (longest first into the lightest leg; unmeasured files spread evenly) and prints this leg's files. Prefer this to a third-party splitter; any outside package is reviewed first.
4. **Matrix:** copy the slow job into a matrix (`strategy.fail-fast: false`, `matrix.shard: [1, ..., N]`) with every setup step, service and environment value exactly as the serial job has them, and run only this leg's files. Keep files that share a database or ports one after another inside a leg.
5. **Prove completeness:** each leg uploads the list of files it ran; one aggregate job (`needs` every leg, `if: ${{ !cancelled() }}`) fails when a leg failed or the lists do not cover every tracked test file exactly once.
6. **Required check:** make the aggregate job the required check in place of the serial job (a branch protection change: the owner approves it).
7. **Remove the serial step:** once the aggregate is green on the default branch twice, remove the serial test step from the old job.
8. **Rebalance:** on `speed.shards-lopsided`, measure again and redo the split; the finding clears at the next check-up.

Worked case: a Python app whose `Validate app` job took about 48 minutes running `python -m unittest discover -s tests` after Python, apt LibreOffice and fonts, `npm ci`, Playwright Chromium, a Postgres service and test environment values. The check-up suggested about 5 shards for 142 tracked `tests/test_*.py` files. The split is a new `python-tests` matrix job of 5 legs, each with the same setup, service and environment as `Validate app`, running `python scripts/ci_test_shard.py --shard N --of 5`: it lists `git ls-files 'tests/test_*.py'`, splits by `tests/test-times.json` and runs `python -m unittest <its files>` in one process. A `python-tests-gate` job checks every tracked test file ran once and replaces `Validate app` as the required check for Python tests; `Validate app` drops its Python test step once the gate is green twice, keeping the browser smokes and Node harnesses.

## Dates And Clocks

- A test that pins a calendar date passes that same clock to every call that reads the time, so it passes at any real date. Prove it in CI with a job that runs the tests that pin a date with the clock moved about a year ahead; the job never counts toward shard coverage, and the final job waits for it.

## Windows

- Give each run its own long-form scratch temp folder inside the user profile for local runs, or under the CI runner's temp folder in CI (never at a drive root, never an 8.3 short name), set as `TEMP` and `TMP` for every child, and remove it when the run finishes, also on failure. Scratch must not outlive the run. Copy any report or evidence you need to its durable home first, then delete the folder; also clear folders an interrupted run left once they are more than a day old.
- A Windows-only failure has a cause; fix the product or the test, never skip it.
