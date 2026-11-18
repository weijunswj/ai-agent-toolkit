Title: owner waits, missed runs and live gates

### Added

- **Owner waits in `attention`:** `programme.cjs attention` now lists every task whose board cell asks something of the owner, after the work queue, as `Owner waits (<n>)` with each task's ask, any gate it comes after, its PR and short head (JSON `owner_waits`). It reads the children's documents at read time and stores nothing; a child that cannot be read prints `Owner waits: unknown (<code>)`, never a short list. One owner step draws the board's `Owner:` cells, CURRENT's `waiting on you` and this list, so they always agree.
- **Missed scheduled runs:** a new no-model checker, `repo/scripts/toolkit-projects-run-missed.cjs`, reads each Projects task's trigger cron (with `CRON_TZ`), creation and last fire times and its run stamps, and prints `RUN MISSED: <task> <time> (fired, no stamp | not fired)` for each fire more than 20 minutes past with no run since, looking back at most 48 hours. Hours the cron never fires, such as an hourly task's night, are never missed. The hourly nudge runs it in step 10 and the coordinator catches each missed run up.
- **Projects owner steps:** the hourly nudge's owner-asks step and the daily check-in now list every board owner wait under **Waiting on owner:** every run until done, and one never pinged is an unrelayed ask. Recording an owed UAT or decision is a new ask, pinged the same turn. The turn a gate thread starts, the coordinator queues its `assign` holder order, so the programme knows the gate is live.

### Fixed

- **A blocker is not an owner step:** CURRENT shows a blocked task as `blocked: <blocker>`, no longer as `waiting on you`.
- **Live gates on the board:** a task with a gate assigned or active shows `NOW · IN PROGRESS` even while a blocker is listed, with `<gate>, then Blocked: <blocker>` as its Waiting on cell; once the gate returns, the listed blocker puts it back in `NOW · QUEUED` with no blocker write.
