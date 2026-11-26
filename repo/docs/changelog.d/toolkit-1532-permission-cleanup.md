Title: permission clean-up in one command

### Added

- **Review permissions.** `toolkit permissions --review` lists every Claude Code permission line in the computer settings and, in the current or named Git repository, its local settings, its worktree copies and its shared settings file (Toolkit adds its own repository lines only where governance is on), as risky, dead or your own, each with an id, in a short grouped list. It writes nothing. Name lines to remove (such as `remove D1-D8 Y2`) and `--review --drop` gives the one `--apply` command that carries those picks and a preview code; every other line stays. "Keep all" needs nothing.
- **One backup folder per run.** `--apply` and `--remove` back every file they write into one folder under `~/.ai-agent-toolkit/backups/permissions/`, with `list.txt` saying where each file goes back, and put every written file back if a write or read-back fails. The backup beside each settings file is gone.
- **Remove takes out only what Toolkit added.** `--apply` records, for every Toolkit settings file in scope (already current ones too), the lines that are Toolkit's; `--remove` takes out only those and old Toolkit lines, from every recorded file, even when the Toolkit folder is gone. `remove toolkit` lists that command and keeps the Toolkit folder until the lines are gone.
- **Auto mode rule for merges.** `--apply` adds one rule to the computer settings' auto mode list, so auto mode does not block a merge Toolkit's merge hold already let through. A list Toolkit creates starts with `$defaults`, so Claude Code's built-in rules stay.
- **Row 1.4 and setup.** The governance bank's permissions row reads `Toolkit lines: ...` and `Other lines: n to review`; ready depends on Toolkit's lines only, and the answer prints the review list with the command. `setup toolkit` shows the same status.

### Changed

- **Old Toolkit lines.** A `node` line counts as an old Toolkit line only when its script is one Toolkit has shipped in a block; a line for another repository's own script stays.
- **This repository** no longer tracks `.claude/settings.json` (web fetch and web search). Toolkit ships no web line; each computer's own settings keep theirs.
