Title: programme file update and governance review fixes

### Added

- `toolkit governance` (also `refresh governance`) in a repository whose programme file an older Toolkit set up now offers to bring it up to date: one question at the end of the summary, and on your yes one pull request that sets `min_toolkit` to this Toolkit's version (so governance waits while a setup part is missing) and adds the checks the default branch already requires and Toolkit's own, keeping the repository's checks. A no writes nothing. You no longer edit `required_checks` by hand.

### Changed

- The permissions review names a command line that joins several commands (`&&`, `||`, `;` or a pipe) as running several commands, and reads a quoted program path by its file name.
