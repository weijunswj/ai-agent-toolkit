Title: setup stops all scheduled task work

### Changed

- Setup and refresh no longer create, update or start scheduled tasks on a computer, and the "May Toolkit update scheduled tasks on this computer?" question is gone. The cloud runs the programme sweep, footer cleaning and shard timings. Setup's `--scheduled-task-update` option is accepted and ignored with one notice.
- On Windows, setup reads Toolkit's task record and prints one line naming how many old Toolkit tasks are still recorded, pointing to `remove toolkit`. It never changes them.
- An old Toolkit task that still fires runs a retired stub: one line, no writes, exit 0. `toolkit update scheduled task` prints the same kind of retired line, and its permission rows are gone; the old task apply and start commands now ask.
- `remove toolkit` no longer notes scheduled tasks for a later reinstall, and setup no longer offers to restore them. A task list an older removal noted is ignored and dropped by the next write.
- Session start no longer prints the Windows task lines. The cloud sweep's health reaches it through the attention line, which reports a stuck sweep.
- The global rules lose the Toolkit task standing approval, and the safety-gates playbook, takeover playbook and Projects guidebook lose the device task route. Projects now reads the cloud Programme Sweep workflow's latest run, and the hourly nudge reports `CLOUD SWEEP` when it failed, skipped or has not run for 2 hours.

### Added

- `toolkit governance check` names a governed repository the cloud sweep skips (state on a public branch, or an evidence store under another owner), with the fix. The sweep's own skip warnings no longer point to a computer sweep.
- Setup and refresh name each governed repository this computer knows that the cloud sweep skips, one line per reason it can tell offline, and point at `toolkit governance check` for the governance App and the sweep workflow.
