Title: cloud and CI findings keep asking until they clear

### Changed

- **Held and skipped sweeps turn red:** each held sweep pass and each skip now prints a titled warning with its code. On the hourly start or a start by hand the sweep gate reads the last runs' warnings: three sweeps in a row held, or skipped for the same reason, or three hourly gate runs in a row skipped because governance is off, turn the gate run red with the step that clears it. Activity runs never go red for this, and the first clean run ends it. The gate's built-in token gains `checks: read` to read those warnings.
- **The sweep gate tells a missing programme file from a refused read:** only a 404 means there is no file; a 401, 403 or server error on the binding is no longer read as governance off.
- **Dependabot pull requests never wait silently:** when auto-merge is off in the binding, the binding cannot be read or no ruleset requires a check, the pull request gets the one marked comment naming why. The template moves to v4, so governed copies show drift until `toolkit governance security` refreshes them.
- **Shard timing drift with no App fails the daily run:** a report-only run that finds a refresh due fails with the owner's step (`--fail-if-due`), and a refresh pull request open over 7 days fails the run naming it.
- **Fallback-risk findings show on the pull request:** under GitHub Actions each one is also a file and line annotation.
- **Re-bump without a key checks instead of repeating a note:** with no push key the workflow lists the owner's open pull requests that carry a version bump and fails naming them, or ends green and silent when there are none. A held re-bump comment keeps the day the hold began, and a hold over 7 days fails the run naming it and the hand command.
