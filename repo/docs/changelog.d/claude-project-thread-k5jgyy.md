### Added

- **Cloud sweep in every governed repository:** `repo/scripts/toolkit-cloud-workflows.cjs --repo <repo>` copies the Programme Sweep and its gate into a governed repository. Each copy is the Toolkit's own file, pinned to the Toolkit commit it came from, and checks the public Toolkit out into `.toolkit/` to run its scripts. The gate follows the repository's CI workflow when one is named with `--ci-workflow`. It pins only a commit on main from a checkout whose origin is the Toolkit repository, and refuses a Toolkit source checkout, a default branch other than `main`, and a same-named file that is not a Toolkit copy. Shard Timings is not copied.
- **Governance enable and refresh:** The repository rules install or refresh adds the copies while governance is on, and the governance enable pull request carries them. `toolkit governance check` reports a missing or hand-edited copy as drift and notes one pinned to an older Toolkit commit, including one whose action pins Dependabot bumped.

### Changed

- **Sweep action:** The cloud sweep runs the Toolkit's scripts from its own checkout and keeps the checked-out repository as the binding and working folder, so the same steps work in a governed repository's copy.
