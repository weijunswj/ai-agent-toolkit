### Added

- **Daily scheduled task sync in Projects:** the daily check-in now reads every scheduled task of the project back once and runs the upgrade plan in its daily mode (`toolkit-projects-tasks.cjs --upgrade-plan <read-back> --memory <memory> --daily`). Each outdated Toolkit task, and each of the project's own tasks on the Toolkit shell, is swapped in place without asking, then every task is read back again and checked with `--upgrade-verify`; only a verified task counts as done, and the run posts only what changed.
- **No unpause question in the daily run:** the daily plan asks nothing; a paused task stays paused and is listed under `paused`, and a task stopped by the owner is never touched. A takeover keeps its one unpause question.

### Changed

- **Shell updates without asking:** a project's own task opted into the Toolkit shell now gets its shell updates from the daily check-in with the same read-back as a takeover, instead of waiting for the owner's word. Its own steps never change.
- **Old full shells are recognised:** a project task still holding the full shell from before pointers (run setup and delivery only) now plans as a shell task and is brought to the pointer form, instead of reading as not Toolkit's.
- **Setup inventory:** a new `shell-tasks` row (checked by TASKS OUTDATED, kept current automatically); the `project-tasks` row now covers only tasks not on the shell.
