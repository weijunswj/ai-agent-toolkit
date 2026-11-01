Title: hook review leftovers


### Changed

- **Pushes through another shell:** the merge hold now refuses any git push handed to another shell or expression runner (`bash -c`, `pwsh -Command`, `cmd /c`, `eval`, `iex` or `Invoke-Expression`), whatever branch it names. It checks runner words throughout the command, including shell option bundles, call operators, wrappers, blocks and unquoted expressions. Encoded PowerShell commands are refused unread, even without a visible push. Run each push as its own git command; plain git pushes keep the exact target check. The attribution guard and the merge hold share one shell-word reader.
- **Codex pushes of the current branch with lane worktrees:** when Codex names no folder and several working trees are reachable from the chat's folder (lane worktrees nested under `.tmp/worktrees/`, for example), a push or pull request of the current branch is now checked in every one of those working trees within the same 30-second budget, and goes when each one passes, instead of being refused outright. It is still refused after any earlier git step of the same command other than a plain read (such as `git reset`, `git stash pop` or a commit), which could move the current branch, or after a relative `cd` from the unknown folder, and a check that runs out of time is still refused on Codex.
- **Helper launches outside gate runs:** the Claude and Codex helper-launch hooks now apply the named-helper policy only in a Toolkit gate run, a session a Toolkit launcher started (a launcher marker). In any other session, governed repositories included, the main session may start any subagent, as the global rules already said, and on Claude a subagent still never starts another in a governed repository, whatever the topology choice.

### Tests

- **Hook pack:** new rows for refused shell and expression-runner pushes, Codex pushes of the current branch with nested lane worktrees, and helper launches inside and outside a gate run. The evidence-store row now passes: its fixture gives another governed repository a cached binding that names the store, with a new row showing a same-named repository under another owner is still held. Fixtures can now set a gate role, nested worktrees with their own commits, a remote owner and a cached binding naming the store.

