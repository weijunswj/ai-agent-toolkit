Title: owner's one-command permissions apply

### Added

- **`toolkit permissions --apply`:** the owner types it in their own PowerShell or terminal. It lists what would change, waits for the typed word `apply`, backs each file up next to itself, merges the computer blocks into Claude Code's user settings (every other key and line kept, stale Toolkit lines reported, never removed) and replaces Codex's own `toolkit.rules`, then reads each file back. `--host claude` or `--host codex` does one app. The repo block is still pasted by hand.

### Changed

- **Permission blocks:** every computer block now makes `--apply` ask: an ask line on Claude Code and a prompt rule on Codex, with `--apply` required as the first argument so the Codex rule matches. Printing and `--check` stay allowed and still write nothing.
- **Agents never run `--apply`:** it refuses in a shell a coding agent started and without a terminal on both ends, and the setup skill and safety playbooks tell agents to hand the owner the command instead.
- **Merge authority:** changes to the apply command wait for a typed merge, like the permission, cleanup and store scripts.
