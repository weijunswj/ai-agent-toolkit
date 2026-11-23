Title: The worktree residue report finishes on large checkouts and checks one worktree

### Added

- **One worktree at a time.** `workspace-residue-report.cjs --worktree <path>` checks only that worktree and, when it is ready to remove, prints the safe lines to run (`git worktree remove <path>`, then `git branch -d <branch>` when its branch is merged, is not a default branch and no other worktree holds it); otherwise it says why it is not ready. `--json` adds `remove_commands`. It never offers `--force` or `-D`, and host-made worktrees are still left to the host.
- **Age.** Each worktree reports `age_hours`, and `--min-age-hours <n>` keeps a worktree made more recently than that out of the ready list.

### Changed

- The report has a time budget (`--budget-ms`, default 60 seconds): worktrees it did not reach are listed as not checked, the report says it stopped, and `--json` carries `complete`. In text mode each worktree line is printed as soon as it is checked, so a checkout with many worktrees shows progress at once.
