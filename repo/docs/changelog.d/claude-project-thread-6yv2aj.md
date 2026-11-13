### Fixed

- **Merge train build:** `toolkit-merge-train.cjs build` refuses a branch that is checked out in another worktree, before it changes anything, so a train can no longer leave another checkout out of step with its branch.
- **Merge train body:** on a train whose UAT line waits on an owner test, members' closing lines become `Refs` lines, so the issue-closure check passes; each member's own closing line still closes its issue when the train lands.
