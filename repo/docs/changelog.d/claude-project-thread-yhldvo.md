### Fixed

- **Cleanup leaves a file with broken Toolkit markers alone:** the leftover scan no longer lists any block in a file whose Toolkit markers are broken, because where a block ends cannot be told. The cleanup names that file once as left in place, keeps it byte for byte and still cleans every other proven copy, instead of stopping with an error and losing the bank row.
- **Bank says why the cleanup cannot run:** a programme file that stops the cleanup after the scan (unreadable, or version 1) now shows as a status row naming why, instead of the row disappearing. A Clean up answer whose write fails exits 1 and says to check the working tree.
- **Template header goes with the governed block:** the current template's curated-source comment above a removed block goes with it, whether or not the owner's text follows. An older wording of that comment stays as the owner's text.
- **Earlier playbook copies recognised by name:** `project-completion-audit.md` and a short-lived `git-completion.md` text are now listed in the playbook history under the names they shipped as.
- **Sweep copies that could not be checked are named apart:** a pinned sweep copy whose commit this Toolkit copy cannot read still holds the cleanup and the parallel CI shards answer, but is no longer called too old; the line says to run from a Toolkit git checkout that has the commit, or to refresh the copies.
- **Session-start note wording:** broken Toolkit markers are the owner's choice to fix, with nothing due in the task, and the checks part is kept beside them. Where governance is on but its programme file cannot be used, the leftover part says what comes first (update Toolkit when it needs a newer one). Checks in a repository whose programme file needs a newer Toolkit say to refresh Toolkit, never to rewrite them from the older copy.
- **Cleanup's next step:** after `--write`, it says to update Toolkit on every app that works in the repository before merging, and never to remove `min_toolkit` to quiet an older copy. A `min_toolkit` value that is not a version is replaced.
- **One version order:** the cleanup, the governance state and the bridge share one version comparison in `toolkit-version.cjs`, and the governance state reads the running version only for a programme file that sets `min_toolkit`.

### Added

- **Hook pack `min_toolkit` fixture key** and rows for the too-old governance line, broken markers and the too-old leftover note.
