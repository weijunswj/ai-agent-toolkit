Title: hook review leftovers

### Changed

- **Nested pushes to the default branch:** the merge hold now reads a push inside a quoted command handed to a shell (`bash -c "..."`, `pwsh -Command "..."`, `eval "..."`) two levels deep, the same way as a plain push, so `bash -c "git push origin HEAD:main"` is refused. The inner shell is not known, so each inner command is judged both with and without its assignments. A push nested deeper is refused unread. The attribution guard and the merge hold now share one shell-word reader.
- **Codex pushes of the current branch with lane worktrees:** when Codex names no folder and several working trees are reachable from the chat's folder (lane worktrees nested under `.tmp/worktrees/`, for example), a push or pull request of the current branch is now checked in every one of those working trees within the same 30-second budget, and goes when each one passes, instead of being refused outright. It is still refused after an earlier step of the same command that could move the current branch, or after a relative `cd` from the unknown folder, and a check that runs out of time is still refused on Codex.
- **Helper launches outside gate runs:** the Claude and Codex helper-launch hooks now apply the named-helper policy only in a Toolkit gate run, a session a Toolkit launcher started (a launcher marker). In any other session, governed repositories included, the main session may start any subagent, as the global rules already said, and on Claude a subagent still never starts another.

### Tests

- **Hook pack:** new rows for nested default-branch pushes, Codex pushes of the current branch with nested lane worktrees, and helper launches inside and outside a gate run. The evidence-store row now passes: its fixture gives another governed repository a cached binding that names the store, with a new row showing a same-named repository under another owner is still held. Fixtures can now set a gate role, nested worktrees with their own commits, a remote owner and a cached binding naming the store.
