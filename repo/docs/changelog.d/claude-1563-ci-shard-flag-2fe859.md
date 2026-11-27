### Added

- The CI check-up flags when shards would pay: `speed.shards` is a GAP for a test job with no matrix that took 10 minutes or more on recent green runs, with a suggested shard count (one per 10 minutes, at most 8) and the repository's tracked test files. `speed.shards-lopsided` is a GAP for legs of one matrix split whose median times are at least 1.5 times and 2 minutes apart.
- The controller check raises both as ATTENTION on its `ci` row, with the next action: the repository's controller arranges or rebalances the shards in the repository's own CI.
- The fast-tests-and-sharding playbook has a new section, Arrange Shards In This Repository's CI, for any stack: decide, measure per-file times, split tracked files, copy the job into a matrix with the same setup, prove every file ran once, swap the required check, then remove the serial step.

### Changed

- The CI check-up's unsharded test job limit (`budgets.unsharded_test_job_seconds`) defaults to 600 seconds instead of 300, and the old judgement row for a long test job with no matrix is replaced by `speed.shards`.
- The CI check-up reads job times from the newest green runs of each workflow (`--runs`, default 5, per workflow), so frequent scheduled runs no longer crowd the CI runs out of the sample. A check-up with GitHub access takes longer in a repository with many workflows.
- The test files counted beside a shard finding are tracked files only (`git ls-files`), so untracked and ignored folders such as `.claude/` or `.tmp/` never count; outside a git checkout the count says it was not counted.
