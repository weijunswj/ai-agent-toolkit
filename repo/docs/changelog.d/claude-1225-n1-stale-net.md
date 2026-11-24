Title: One stale-work net in the programme sweep

### Added

- **The stale-work net.** The programme sweep now raises the stale check's rows as attention findings, with the usual life (new, acknowledged with a due time, overdue): `OWNER_OK_CLOSE` for a task whose PR merged, whose agent UAT passed and with no gate open and every DONE WHEN row ticked, so only the owner's OK to close is left; `CHILD_NO_NEAREST` for a task opened in the last 7 days with no `Nearest child:` line; `POLISH_CAP` for a polish task at 8 rows or more, or while two are open; and `ROWS_UNTICKED` for a task with a merged PR while none of its DONE WHEN or ROWS checkboxes is ticked. A merged task's `READY_TO_CLOSE` and `TASK_MERGED_OPEN` details say how many DONE WHEN rows are still unchecked.
- **Net findings cannot hang.** Each finding code says whether it is part of the net, its longest acknowledgement and whether it may be disposed. `OWNER_OK_CLOSE` and `POLISH_CAP` are never disposed (`FINDING_NO_DISPOSE` names the routes that clear them), and an acknowledgement past a code's cap is refused with that cap named.
- **The 4-hour callout.** `programme.cjs attention` lists the net findings nobody answered for 4 hours (new for 4 hours, or acknowledged past their due time) first, under `Unanswered over 4 h (<n>)`; `--json` adds `callout`.

### Changed

- `BODY_OVER_BUDGET` is raised only when a page is 5 per cent or more over its budget (500 characters for the parent, 200 for a task, 150 for a pull request), so a page a few characters over raises nothing.
- `CLOSED_WITHOUT_ACCEPTANCE` is no longer raised for a task closed as completed that has its closing story after the close.
- Update Toolkit on every computer that runs the sweep: an older Toolkit holds on a parent document carrying the new finding codes (`attention[n].code is not a known finding code`) until it is updated.
