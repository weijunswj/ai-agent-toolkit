Title: one task auto-merge switch per repository

### Changed

- Task auto-merge is now one switch per repository: `task_prs.auto_merge` (`after-gates` or `off`) in the governance binding merged on the default branch. Every app and the Projects controller read the same switch; no key is off. A working tree, label, project line or app-local file grants nothing.
- Setup no longer asks a task auto-merge question, and the `--task-auto-merge` flag is gone. Setup says once per run, while an older per-app answer is still on the computer, that the switch now lives in each repository's governance.
- The gate rules' Task auto-merge section names the binding switch as the only switch, and the Projects project line is no longer an override.

### Added

- `setup governance` and `refresh governance` typed commands. `setup governance` asks the switch together with the governance yes in the same proposal; in a governed repository it is `refresh governance`. `refresh governance` shows the merged answers (governance, switch, evidence store, required checks) and the repository's permission block, and with `--set on` or `--set off` prepares one pull request that changes only the switch. It never writes the binding itself.
- A governed repository whose binding sets no switch shows one line, "Task auto-merge is off here until you set it; say refresh governance", in `toolkit governance status`, `check` and `refresh`. It is a line, not a hold.

### Removed

- The per-app task auto-merge answers older versions saved under `~/.ai-agent-toolkit/user-state/` are deleted by the first governance read that reads a repository's new switch back fresh, and never before.
