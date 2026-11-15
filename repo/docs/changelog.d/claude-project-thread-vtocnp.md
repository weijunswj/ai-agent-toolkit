### Fixed

- **Hourly nudge PR owners on quiet runs:** step 5 now takes each open PR's owner from the thread list step 2b reads on every run, instead of step 2's list, which a quiet run skips. A thread that takes the PR step over because the run could not read GitHub pages the thread list itself.
- **Unowned evidence-store PRs:** the `PR UNOWNED` action keeps the owner's OK for closing a task-repository PR only. An evidence-store PR is merged or closed without asking, because the store is agent-managed with standing permission.
- **Other projects' outdated tasks are report only:** the platform changes a scheduled task's prompt only from the thread that task posts into, so the Toolkit project's daily check-in and its `PROJECT TASKS OUTDATED` action now name the project and task for the owner and never call `update_trigger` across projects. Each project's own coordinator swaps its own tasks when its own check-in reports `TASKS OUTDATED`.
