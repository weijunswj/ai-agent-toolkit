### Added

- The stale check flags a child whose page shows a merged PR while none of its DONE WHEN or ROWS checkboxes is ticked, as an `UNTICKED?` row. The row shows once for each new merged PR; on later days the child is named on the `held, not proposed` line until a row is ticked. It reads only checkbox rows under those headings (fenced code and HTML comments hold none) and only merged rows of the PR GRAPH the sweep draws.
- The session-start stale-check line counts `KEPT OPEN?` and `UNTICKED?` rows by kind.

### Changed

- A merged child kept open on purpose (`Kept open:`) is no longer skipped for ever: once no lane, holder, write or comment has touched it for six hours, the sweep raises `TASK_MERGED_OPEN` again, saying it was kept open, and the stale check shows it as a `KEPT OPEN?` row. A longer planned wait is a dispose with a reason, which holds while the child stays still.
- In a cloud session, an evidence store that answers 401, 403 or 404 now says it is not reachable from that session and that the check waits for the owner's computer, instead of advising a different store.

### Fixed

- The first per-repository stale-check stamp write removes the old shared `user-state/stale-sweep.json`. A test now pins that the stamp is written to a temporary file and renamed, and a dead comment and test about the old shared stamp are gone.
