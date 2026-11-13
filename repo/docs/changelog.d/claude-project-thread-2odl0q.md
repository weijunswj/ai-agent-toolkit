Title: PR edits no longer cancel CI checks

### Fixed

- **A pull request title or body edit no longer cancels the Validate run in progress.** The edit run now waits for it and then runs in full, so the newest event still finishes last and a fixed body still clears the required check. A new commit, an open or a reopen still cancels the older run.
- **A cancelled Validate run reports `validate` as cancelled, not failed.** The aggregate job now runs with `if: ${{ !cancelled() }}`: it still runs and fails when a shard failed or timed out, but a run that was cancelled no longer fails with "no shard summaries". The secure CI/CD prompt template says the same for the final job.
- **The programme sweep no longer reports a false `CHECKS_RED` from a cancelled run.** A cancelled result of a required check is set aside when the same check has another result at the head; a check whose only results were cancelled still counts as failed.
