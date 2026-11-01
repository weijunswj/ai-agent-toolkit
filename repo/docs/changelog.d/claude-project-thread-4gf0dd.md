Title: Refresh open release branches

### Changed

- Keep each open release branch's patch, minor or major bump when main moves. A coordinator-run local command reports eligible branches and can merge main, regenerate version stamps, preserve released notes and fast-forward the branch after validation.
- Accept major version bumps in the release command and version guard, and report the resolved base commit used for a bump.
- Document the local reconciliation trigger, conflict recovery and renewed CI and review required for each updated head.
