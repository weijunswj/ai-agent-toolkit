Title: programme graph status bands

### Fixed

- **The programme graph sorts by status band:** rows now run `NOW · IN PROGRESS`, then `NOW · QUEUED`, then `LATER`, then the latest `COMPLETED`, then `RETIRED`, so moving work no longer mixes with work parked behind a blocker. Inside each band the order is as before: priority, then child number, optional tasks at the end of `LATER`, and tasks pinned with `last` at the end of their own band, so a pinned task in progress never drops below `LATER`. CURRENT's In progress list and the native sub-issue order follow the same bands, so the first refresh after this release reorders native sub-issues once.
- **Queued tasks are off the work queue:** a task whose state lists a blocker (shown `NOW · QUEUED`) no longer raises `TASK_IDLE` or `TASK_MERGED_OPEN`; its blocker says why. The batch tail guard and the one-level native blocker rule are unchanged.
- **An owed UAT reads as a UAT:** a task waiting on the owner with a UAT still owed shows `Owner: UAT on PR #<n>` in the graph and `your UAT on PR #<n>` in CURRENT, not `Owner: decision`. A gate waiting on the owner still shows `Owner: decision`.
