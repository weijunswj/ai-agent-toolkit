Title: one-time permission blocks and checked cleanup

### Added

- **`toolkit permissions`:** `repo/scripts/toolkit-permissions.cjs` prints two paste-once blocks so Toolkit's own reversible commands stop asking each time. The computer block covers the programme commands that keep records in step, the scheduled-task commands and the cleanup command. The repository block covers pull request and issue comments and one exact evidence store push to the store's own origin and branch; merges are never in a block. A line carries a wildcard only where the script behind it checks its own arguments, and ask lines cover a task repair, a folder override, a skipped first run, a keep-or-replace answer and a comment delete. Codex cannot ask for a flag, so those commands are prompt rules in the Codex block. It only prints and checks; the owner pastes. `--check <file>` reports missing and stale lines, and `--format allowed-tools` prints the same lines for a single launch.
- **`toolkit cleanup`:** `repo/scripts/toolkit-cleanup.cjs plan|apply` removes Toolkit scratch only: finished worktrees, temp files under the scratch folders and local branches already merged into the default branch. It never removes part of a worktree or a clone, a bare repository, anything whose path goes through a link, or anything behind a linked scratch root, and it counts every untracked and ignored file whatever Git's settings say. It always reads the evidence store back first, deletes nothing when there is no store to read back, and prints one line saying what it cleaned and what it kept.
- **Start a recorded scheduled task:** `repo/scripts/toolkit-windows-tasks.cjs start --task <id>` runs one Toolkit-owned task now, and refuses tasks Toolkit does not own, the owner stopped, Task Scheduler shows as turned off, or someone edited by hand.

### Changed

- **Safety gates:** the hard stop on saved permission rules now names the printed blocks as the supported route. Agents still never write host settings or rule files.
- **Merge authority:** changes to the permission and cleanup scripts wait for a typed merge.

### Not included

- Claiming a controller seat, removing or adopting tasks, repairs, closing issues, deleting remote branches, forced, mirror or deleting pushes, a push anywhere but the store's own origin and branch, settings edits and secrets stay outside every block and keep asking.
