Title: periodic runs hand GitHub steps to a thread with the repos and recover skipped schedules

### Claude Projects

- **Added:** the hourly nudge and the daily check-in start their first line with `GITHUB STEPS OWED: <steps> | ` when a step could not read GitHub (the nudge's CI waits, PR sweep and programme sweep; the check-in's GitHub and checker steps), instead of only saying so.
- **Changed:** a coordinator without repo access no longer finishes a task run by relaying it: the same turn it hands every GitHub step of the run to a thread that has the repos, and writes `.done` only after that thread reports back (**GitHub steps need repo access** in the recurring-tasks reference, and the skill's **Every task run reaches the project chat** line).
- **Added:** the hourly nudge's PR step also reads each scheduled workflow's newest run and raises `SCHEDULE MISSED: <names> | ` when a scheduled time passed more than 30 minutes ago with no run since, because GitHub can skip a scheduled run. The coordinator re-reads the newest run, then has a thread with the repos start it by hand on the default branch only when the workflow stays inside the repository's own GitHub state or the owner approved it by name; anything else waits for the owner.

### Changed

- The Source Watch PR Notifier can now also be started by hand, on `main` only (a manual run on any other branch does nothing), so a skipped scheduled run can be recovered without waiting for the next schedule. A test now requires every scheduled workflow in the repository to take `workflow_dispatch`.
