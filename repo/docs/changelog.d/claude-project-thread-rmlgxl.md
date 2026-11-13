Title: rolling merge trains

### Changed

- Controllers now run rolling merge trains on their own. While a landing is in flight, ready pull requests board the open train; when main frees, boarding closes, the train catches up with main, bumps once and merges after one CI run, and the next train opens at once. A lone ready pull request merges alone, and no pull request waits on a train. The Controller routes its merge step to the page that holds the train rule, the Claude Projects skill points there, and the hourly nudge flags ready pull requests that no train holds.
- Running a merge train needs no planning or build gate and runs on the small model tier. The lane never fixes a conflict: it ejects the member and that member's builder fixes it. A train needs no review of its own once `verify` passes and CI is green; only files two or more members change get a short delta review.

### Added

- `toolkit-merge-train.cjs catchup` merges main into a stacked train after the earlier landing and adds the one bump, with no rebuild or force-push.
- A merge train holds at most six members (`build` refuses a seventh), and its body carries every member's `Pack changes` lines (`pack_changes` in the manifest). A member that fails CI or its delta review is ejected at once and the rest carry on; nobody edits a train or member body while its CI runs.
- A stacked train's pull request targets the running train's branch until that train lands, so the version check does not report its waiting fragments as unfolded; it then targets main before `catchup`.
- In Claude Projects the train's merge card goes up in the train thread, which runs `land` and the merge itself, because a relayed tap does not count there; the fallback is the owner typing `merge PR N at <full SHA> as a merge commit` in that thread.
- `toolkit-merge-train.cjs verify` lists the files two or more members change (`overlap`) and the review the train needs (`review`).
