### Added

- **The repository's own rulesets in the settings fix:** refresh governance's "Fix the drifted GitHub settings?" question can now also change a governed repository's own rulesets on the default branch, each shown from before to after: merge commits only, branches up to date before merging, and the programme file's checks pinned to GitHub Actions where each has exactly one workflow job producing it. Nothing is written without your yes to that exact change, a ruleset that changed since it was shown is left alone, each change is read back, required checks are never added or removed there, and organization rulesets and Toolkit's own are never touched.

### Changed

- **Short governance summary cells:** the Branch protection and rulesets and Security settings cells now hold each state with its count, such as "Drift: 1 item; Waiting for you: 2 items, listed below", and every finding follows the table as a short list, one per line. A part that is all on says just On.
- **No terminal chores for the owner:** refresh governance results, the post-merge finish and the session-start drift line no longer tell the owner to run `toolkit governance migrate` in their own terminal. The agent runs refresh governance again itself, and anything only the owner can change comes with where to change it in GitHub's settings (Rules, then Rulesets; General, under Pull Requests; Collaborators and teams for the admin role).
- **One binding pull request per refresh:** while Toolkit's refresh pull request is open and adds a check of Toolkit's own (such as personal-data) that the programme file does not list yet, the programme file update waits for it to merge, then one pull request covers that check too, so the owner never merges two programme file pull requests in a row.
- **A dropped answer says what changed:** when an answer to refresh governance is not used because what Toolkit showed has changed since, the line now names the parts that changed, such as Task auto-merge with merge train.

### Fixed

- **Workflow reader and block scalars:** the default-branch protection check now skips a block scalar (`>-`, `|`) under a key it never reads, such as a service's `options` or a step's `with`, instead of marking the whole workflow unverified. A CI workflow with a database service's health options now has its required check found, so Toolkit's protected-branch ruleset is offered. Block scalars where the reader reads a value (a job, an event, a name, `needs`, a matrix, an environment value) stay unverified.
