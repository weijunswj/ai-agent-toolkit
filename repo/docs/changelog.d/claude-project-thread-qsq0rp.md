### Fixed

- A shard timing refresh pull request now ends with `UAT: NOT_REQUIRED` and `Bump: none` lines, so the auto-merge check accepts it and the merge train finder can board it once its review passes. Before, every such pull request needed both lines added by hand.
