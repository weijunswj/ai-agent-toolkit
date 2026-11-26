### Added

- A proved Toolkit refresh pull request in a governed repository lands on its own: where the repository's task auto-merge switch is On, `toolkit-cloud-workflows.cjs --repo <checkout> --land-refresh` checks that every changed file is byte for byte Toolkit main's own render at the Toolkit commit the refresh names, that the repository's TOOLKIT_REF does not pin it and that its required checks are green, then names the exact pinned merge command and the notice to post after. The merge hold runs the same copy proof before it lets that merge through with no typed approval. Anything else in a refresh pull request still waits for the owner's typed merge.
- Refresh pull requests carry a `UAT: NOT_REQUIRED` line and say who lands them.

### Fixed

- The session-start stale-copy line judges a governed repository's Toolkit copies on origin's default branch as the session start's binding read fetched it, never on the working tree, so a checkout that is behind no longer reports copies as missing or asks for a needless refresh pull request. The governance check reads the copies the same way.
- The refresh and the stale-copy check see a shard list's test files by name, so a usable shard list no longer reads as finding no test file.
