Title: merge before owner tests, bump once at merge, one real-host round per release

### Changed

- Owner UAT no longer holds a merge. A pull request whose line is `UAT: OWNER_TEST_NEEDED` merges on its review and green CI; the owner tests the installed build afterwards, its tasks stay open on `Refs` until their OK, and a failed test gets a fix-forward or revert pull request. The task auto-merge check now exits 0 for an owner test once scope allows, and says the test follows the merge.
- Pull requests hold `main`'s version and carry only a changelog fragment plus a `Bump: patch|minor|major` body line. The merging agent bumps once, at merge time, so a merge no longer forces a re-bump, new CI and a stale merge card on every other open pull request. Older pull requests that already carry a bump still go through the re-bump workflow.
- Hook changes read the hook pack from CI's Linux and Windows runs. The real-host smoke and the qualification matrix run once per release batch, after its merges, on the installed build and before the owner tests.
