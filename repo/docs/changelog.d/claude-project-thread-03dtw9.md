### Fixed

- The personal-data guard's git hooks now find the guard in the Toolkit's own checkout (`skills/secure-ci-cd/scripts/personal-data-guard.cjs`) when there is no `.github/scripts/` copy, so commits and pushes there run the real guard with no hand copy. With neither file present they still block.
- In a Toolkit checkout the installer now installs or refreshes only the hooks (no guard copy, no workflow) instead of refusing, so rerunning it repairs an older hook. `--check` there reports an outdated hook as drift; no hooks at all is still fine.
- The pre-push hook's plain-text step finds the check's in-repo source the same way, so a push from the Toolkit's own checkout runs it on the changed files, as other repositories with a copy already do.
- In a Toolkit checkout, a leftover `.github/scripts/personal-data-guard.cjs` would run in place of the in-repo guard, so the installer warns about it and `--check` reports it as drift. A repository counts as the Toolkit only when it has both the guard source and the governance conformance script, so one stray file does not make another repository skip its guard copy and workflow.
