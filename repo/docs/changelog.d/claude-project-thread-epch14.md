### Changed

- Projects coordinators now treat every scheduled-task line that carries a warning as work for that turn, never a quiet no-reply. A warning they cannot clear, or the same warning on two handled runs in a row, goes to the owner once with the exact step.
- The hourly nudge reports `COORDINATOR BEHIND: <n> runs` when its own earlier runs were never handled, and tells the owner how to unblock it. Its unrelayed-run lists show the 5 oldest plus a count, so a backlog no longer floods the report.
- The hourly nudge rotates its home thread after 3 days instead of 7, and any bound task that loses context writes a `handoff.md` for its new home thread. A rotation never moves a task: the new home thread creates its own copy of the task, reads it back (never firing it), deletes the outdated one after saving its record and updates the task id in project memory, after the owner's one-time go.
- A task check that needs an id, memory line or file it cannot find now reports `NEEDS SETUP` with what to add and where, never a bare "unknown".
