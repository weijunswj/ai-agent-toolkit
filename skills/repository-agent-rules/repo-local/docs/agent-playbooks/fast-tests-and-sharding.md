# Fast Tests And Sharding

Use when tests or CI got slow, or when adding a test runner, test shards or CI test jobs. Speed must never cost coverage: never skip, sample or delete a test to go faster.

## Measure First

- Time each test file on every supported system, the whole suite as CI runs it, and the slowest single tests. Put before and after numbers (files, tests, skipped, time) in the PR; any drop in tests blocks.
- Declare a per-file time budget once measured, and use a small check that reads the per-file times of a run and fails any file over its budget. Raise one file's budget only with a recorded reason.
- Prefer caching or path filters only when the measurement shows they save real time and the same checks still run.

## Make Slow Files Fast

- Tests inside one file run one after another, so the slowest file sets the floor. Fix it first.
- Run a file's tests concurrently only when each test owns its temp folder and removes it when it ends, and none touches shared `process.env`, the working directory, module state or a real user folder. Otherwise split the file by area.
- Replace repeated expensive setup with one template per file (a fixture repo or workspace copied or cloned per case), and call code in process instead of spawning it when the same path is covered.
- Accept a converted file only after several consecutive green runs on every system with identical test counts.

## Shard From One Manifest

- One manifest lists named shards per system and one `rest` shard per system that takes every file no other shard names, so new files always run.
- The runner refuses an unknown or empty shard and fails when a file does not load. CI and local runs read the same manifest.
- One final job waits for every shard, runs even when one failed, and passes only when every shard succeeded and the shard summaries cover plain test discovery exactly once per system, with at least one test per file and no failure or cancellation. Make that job the required check.
- A drift guard pins the exact test step text and matrix, and its own test shows it rejects narrowed paths, name filters, `if: false`, `; exit 0` or `|| true`, `continue-on-error`, matrix `include`/`exclude` edits and a runner that ignores its shard.

## Windows

- Give each run its own long-form scratch temp folder inside the user profile for local runs, or under the CI runner's temp folder in CI (never at a drive root, never an 8.3 short name), set as `TEMP` and `TMP` for every child, and remove it when the run finishes, also on failure. Scratch must not outlive the run. Copy any report or evidence you need to its durable home first, then delete the folder; also clear folders an interrupted run left once they are more than a day old.
- A Windows-only failure has a cause; fix the product or the test, never skip it.
