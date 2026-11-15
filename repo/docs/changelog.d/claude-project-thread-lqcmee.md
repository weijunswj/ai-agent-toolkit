Title: old scheduled-task code removed

### Removed

- Toolkit's Windows scheduled-task code is gone: the task runner and its retired stub, the task launcher, task health, `toolkit update scheduled task`, and the task planner, apply, start and adopt commands. The cloud has run these jobs since 3.111.0. An old Toolkit task that still fires on a computer now fails to start; say `remove toolkit` to list and remove it after your OK.
- Setup's retired `--scheduled-task-update` and `--remove-toolkit-tasks` options are gone. Setup still prints one line when old Toolkit tasks are recorded on a Windows computer, pointing to `remove toolkit`.
- The permission ask rows for the old task commands are gone, since those commands no longer exist.

### Changed

- `remove toolkit` keeps a small legacy cleaner for old tasks. It removes a task only while it still carries Toolkit's marker (or the exact description an old launcher wrote when it disabled it) and still matches the definition Toolkit recorded. A task you made or that Toolkit only listed is never removed, and a Task Scheduler folder goes only when it is empty.
- The `schedule_folder` binding key is retired: it is still accepted, so a binding that carries it stays valid, and nothing reads it.
