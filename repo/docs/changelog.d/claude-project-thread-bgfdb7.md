Title: parallel CI shards question

### Added

- **Parallel CI shards question:** `refresh governance` in a repository whose merged binding turns governance on asks "Split this repository's tests into parallel CI shards?" with yes, not now or never ask, and shows the runner minutes of the largest recent green CI run on the default branch, or says they are unknown. It is never asked in an ungoverned repository. Not now writes nothing and the next refresh asks again; never stops the question.
- Yes and never are each one binding pull request that sets only `ci_shards` (`answer`, `offered_at`) in the exact merged binding text, with the Toolkit version line in its body. A yes also adds a first `.github/toolkit-test-shards.json` when there is none: Node tests run with `node --test`, one rest shard plus one named Linux shard per 10 measured minutes, or two shards when the minutes are unknown. For other tests it writes no list and says so.
- The answer is refused while a pinned `.toolkit` sweep copy in the repository runs a Toolkit older than the one that reads `ci_shards`, naming the step: refresh the repository rules first.

### Changed

- The cloud workflows installer copies the test shards workflow and Shard Timings only when the merged binding answers yes to `ci_shards` and the shard list is usable; otherwise it says they were not copied and why.
- `toolkit governance check` reports a test shards copy left at an older workflow name as drift, and suggests making `Toolkit test shards` a required check while the copy is in place and it is not required. It never sets the check.
