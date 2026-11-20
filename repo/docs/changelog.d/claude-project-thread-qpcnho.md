Title: governed copies follow Toolkit main

### Changed

- **Governed copies follow Toolkit main:** the cloud sweep, its gate, the test shards workflow and Shard Timings in a governed repository now check out Toolkit `main` instead of one pinned commit, so every Toolkit fix reaches them at their next run with no pull request there. The owner holds one repository on a known-good commit with `gh variable set TOOLKIT_REF --repo <owner/name> --body <commit>`, and removes the variable to follow main again.
- **Stale means the layout only:** a copy is current while its body is what a refresh writes now, whichever Toolkit commit rendered it. A copy from before this release, pinned to one commit, counts as stale until its refresh lands.
- **Previous layout keeps working:** a contract records what the copies run, and a test fails when that changes until a new layout number is recorded with the old calls still served, and when main stops dispatching a subcommand or reading an environment name a recorded call passes. The sweep action refuses an unknown command instead of running a refresh.

### Added

- **One refresh pull request per repository:** `toolkit-cloud-workflows.cjs --repo <checkout> --refresh-pr` opens or updates one owner-merged pull request with the stale workflow copies, outdated vendored checks and a plain-text baseline still in the old format (migrated as `--migrate-baseline` does). Governed repositories only; nothing partial on failure; never merged by an agent. A rerun from a newer Toolkit commit with the same copies adds no commit, and a shallow Toolkit clone is told to run `git fetch --unshallow origin`.
- **Cloud sessions see stale copies:** each ENABLED repository in a cloud session gets the same stale-copy note as a computer, with the refresh command, when a Toolkit checkout is there to compare with.
- **Cloud sweep finding:** the cloud sweep raises `CLOUD_LAYOUT_STALE` on the attention list while a repository's copies are stale, naming the refresh command, and it resolves once the refresh lands.
