Title: controller handoff snapshot removed

### Removed

- The controller handoff snapshot is gone, with no replacement: the `toolkit-store.cjs handoff` command, its planner script, the Claude Code after-tool hook that refreshed it, the controller check's `handoff` row and `--handoff` flag, its hook test pack rows and fixtures, and every doc, skill and Projects line that pointed to it. A successor controller works from the GitHub records, the evidence store and Projects memory. `handoff` is now refused as an unknown store command and as an unknown `--skip` name.
- The evidence store command deletes no file at all: a deletion in a save, a move, a merge or any commit it would push is refused, with no exception for snapshot memory files.
- Toolkit's scheduled Projects task prompts no longer start with `touch ~/.toolkit-handoff-off`, and their controller check commands no longer skip `handoff`. The daily check-in reports the stored ping and pointer prompts as outdated until they are saved again.

### Changed

- Every session start, in Claude Code and Codex, removes what the snapshot left on the computer: `handoff-sessions/`, `handoff-folders/`, `handoff-refresh.json` and `handoff-refresh.lock` in Toolkit's user-state folder, and an empty `~/.toolkit-handoff-off`. Only those exact names of the kind the snapshot wrote are removed; a link, a file with content in the home folder or any other name is left alone, and nothing is printed.
