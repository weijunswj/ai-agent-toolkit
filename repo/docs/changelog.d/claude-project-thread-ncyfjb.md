### Added

- **Governance post-merge finish:** after the question bank's turn-on pull request is merged, the next session starts `toolkit-governance.cjs finish` in the background. It adds default-branch protection, the ruleset that blocks force pushes and the free dependency and security settings without asking again, and the following session shows the result once. A setting GitHub cannot read back keeps it pending, with the reason, and it is tried again later.
- **One closing line for the turn-on:** the bank's setup pull request ends with a fixed summary (its link, what merging does, the files it holds, what finishes after the merge) and one line: "Merge <link>. Nothing else is needed from you."

### Changed

- **Re-runs update the open setup pull request:** answering the bank again while the turn-on pull request is open adds one commit with the new answers to the same branch, never a second pull request. Toolkit changes only its own turn-on branch.
- **Rendered from the managed checkout:** the turn-on and `toolkit governance check` render the cloud workflows with the managed Toolkit checkout's own installer, so a lagging plugin copy cannot render workflows that do not match their pinned commit.

### Removed

- **Shard timings `--fail-if-due`:** nothing used it; `--warn-if-due` stays.

### Fixed

- **Setup file wording:** the docs now say that an older Toolkit copy of the dependency auto-merge workflow is refreshed, instead of "existing files are never changed".
