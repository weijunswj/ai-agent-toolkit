Title: rolling merge trains

### Changed

- Controllers now run rolling merge trains on their own. While a landing is in flight, ready pull requests board the open train; when main frees, boarding closes, the train catches up with main, bumps once and merges after one CI run, and the next train opens at once. A lone ready pull request merges alone, and no pull request waits on a train. The Controller routes its merge step to the page that holds the train rule, the Claude Projects skill points there, and the hourly nudge flags ready pull requests that no train holds.
- Running a merge train needs no planning or build gate and runs on the small model tier. The lane never fixes a conflict: it ejects the member and that member's builder fixes it. A train needs no review of its own once `verify` passes and CI is green; only files two or more members change get a short delta review.

### Added

- `toolkit-merge-train.cjs catchup` merges main into a stacked train after the earlier landing and adds the one bump, with no rebuild or force-push.
- `toolkit-merge-train.cjs verify` lists the files two or more members change (`overlap`) and the review the train needs (`review`).
