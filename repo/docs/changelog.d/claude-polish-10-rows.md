### Fixed

- The programme sweep now resolves a merged or closed pull request's over-budget page finding on its next complete pass. Such a pull request keeps the body it was approved with, so its finding no longer needs a dispose by hand. Open pull requests and task pages still count.
- The background stale check now runs only when the binding merged on origin's default branch has governance on, the same binding the session-start hook reads before it starts the check. Before, a worktree made before governance was turned on skipped the check with no stamp, and the hook started it again every 15 minutes.
- A cloud session that has an attention cache but no stale-check stamp for today now says the stale check waits for the owner's computer. Before, it said nothing about it.
- The controller handoff snapshot now refuses a source file holding a NUL byte, as the store's save does, and the handoff hook starts no refresh for it. Before, every refresh wrote the file, stopped at the save and undid the write, so `--check` stayed STALE.
- The handoff snapshot README now gives a successor a reading order: `MEMORY.md` first when the snapshot holds one, then the saved instructions, then the named working files.

### Tests

- New handoff tests cover the dot-name skip, the 5 MB cap, the undo removing a created file, `--check` with a named memory folder and Windows network-share paths.
- A new hook pack row checks that a scheduled task's `touch ~/.toolkit-handoff-off` passes every guard on both hosts.
- A new hook pack row checks that a memory file saved with a NUL byte starts no handoff refresh.
