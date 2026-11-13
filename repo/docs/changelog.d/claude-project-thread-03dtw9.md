### Fixed

- The personal-data guard's git hooks now find the guard in the Toolkit's own checkout (`skills/secure-ci-cd/scripts/personal-data-guard.cjs`) when there is no `.github/scripts/` copy, so commits and pushes there run the real guard with no hand copy. With neither file present they still block.
- In a Toolkit checkout the installer now installs or refreshes only the hooks (no guard copy, no workflow) instead of refusing, so rerunning it repairs an older hook. `--check` there reports an outdated hook as drift; no hooks at all is still fine.
- The pre-push hook's plain-text step finds the check's in-repo source the same way, so a push from the Toolkit's own checkout runs it on the changed files, as other repositories with a copy already do.
