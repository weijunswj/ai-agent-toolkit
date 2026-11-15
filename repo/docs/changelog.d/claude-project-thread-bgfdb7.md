Title: sharded test workflow copies for governed repositories

### Added

- **Test shards workflow for governed repositories:** where a governed repository has a usable shard list (`.github/toolkit-test-shards.json`), the cloud workflows installer copies a test shards workflow into it, pinned to a Toolkit commit like the sweep copies. It runs a matrix job per system with the list's shard ids, uploads each shard's summary under the same artifact name as the Toolkit's own shards, and a gate job, `Toolkit test shards`, fails unless every discovered test file ran exactly once on each system on the commit and passed, naming any file that did not. It reads the repository only, uses no secret and adds to the repository's own CI without replacing it.
- **`run-tests.cjs --repo-root <dir> --verify <folder>`:** the gate check over a run's shard summaries.
- **Shard Timings for governed repositories:** the same repositories get a Shard Timings copy, and `refresh-shard-timings.cjs --repo-root <checkout>` refreshes a v2 shard list from the newest green run of the workflow the list names, writing per-file times and rebalanced named shards back to that list. The Toolkit's own v1 manifest, Validate runs and Shard Timings are unchanged.

### Changed

- The installer copies neither workflow into a repository without a usable shard list and says why. A change to the list's shards makes the test shards copy outdated, not edited, and `toolkit governance check` reports the new copies' drift with what it costs the repository.
- Turning governance off removes the test shards and Shard Timings copies too, and the left-over reports name them. The Toolkit copies are now found by their rendered-copy marker, so the test shards copy is found at whatever name its shard list chose, and a marker for another copy at a path does not count.
- A test shards or Shard Timings copy left after the shard list went missing, stopped validating or names an unsupported program is drift in `toolkit governance check`, with the fix: repair the list, or remove the shard copies in a pull request.
- The shard copies run on the repository's default branch: the installer renders it into their push trigger, and `refresh-shard-timings.cjs` takes `--branch <name>` for a governed list (or asks GitHub), using it for runs, refresh pull requests and their base. The Toolkit's own refresh stays on main.

### Known limits

- The test shards jobs set up Node only, so the installer refuses a list whose command starts with another program (such as `python`, `pytest` or `npx`), naming it, and copies neither workflow there.
