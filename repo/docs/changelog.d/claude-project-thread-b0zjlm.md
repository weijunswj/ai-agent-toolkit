Title: version at merge time

### Version at merge time

- **Open branches keep `main`'s version:** a branch no longer changes `version.json`, the plugin manifests, the managed-block markers, the CHANGELOG headings or the Projects skill Version line while it is open. Its notes go in its own fragment in `repo/docs/changelog.d/`, so open branches stop conflicting on version lines and renumbering after every merge.
- **One step at merge time:** after the branch merges `main`, `node repo/scripts/bump-version.cjs --next patch` (or `minor`) reads `main`'s version, sets the next one, folds the fragments into the CHANGELOG, deletes them, refreshes every copy of the version and bumps the Projects skill Version line when the branch changed that skill. It refuses when the branch is behind `main`, the tree has uncommitted changes, the branch already set its own version or CHANGELOG heading, or there is no fragment. The explicit `bump-version.cjs <x.y.z>` form still works.
- **CI guard:** validation accepts a pull request that holds its base's version, or one that sets exactly the next patch or minor version with its CHANGELOG heading and no fragment left. A stale or skipped number, or a half-done bump, fails with the fix to run.
- **Projects skill test:** the test no longer pins one exact skill Version, so branches that change the skill stop conflicting on it.
