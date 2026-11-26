### Added

- **Takeover shows the controller settings:** a controller takeover's dry run and done line now show the stack profile, live lanes and where gates run, read from the evidence store with one request, or say that none are saved yet, that they belong to another repository or that they cannot be read. They never name the device or folder.
- **Scheduled task upgrade at a takeover:** `toolkit-projects-tasks.cjs --upgrade-plan` reads a project's scheduled tasks as the host read them back and names each one current, outdated (with its exact replacement prompt), waiting for its project additions, hand-made, damaged, not Toolkit's or stopped by the owner, and lists the paused ones in one unpause question. `--upgrade-verify` checks the read-back after the swaps: each replacement is stored, nothing else moved, and only the tasks the owner named were unpaused. A task stopped by the owner is never touched.

### Changed

- **Takeover without the evidence store:** a session that cannot use the store (often a cloud one) now says it claims nothing and to run the takeover in a session that can, such as one on the owner's computer.
- **Owner-line lint and named computers:** two lines that name different kinds of computer (a desktop and a PC, say), or a line naming one while the controller settings name a device, are now a conflict to ask the owner about, never a duplicate or repeat with a fix.
- **Owner-line lint under a turning heading:** a line that repeats Toolkit's block under a heading that may change what it means (such as "Not in this project") is no longer offered for removal.
