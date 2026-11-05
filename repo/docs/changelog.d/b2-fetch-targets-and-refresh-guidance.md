### Fixed

- Keep Bridge updates and shard refresh worktrees on their own fetched commit when another fetch runs at the same time, and remove only the invocation's temporary ref.
- Use a wider Linux shard-balance trigger while keeping the Windows trigger, and state the review and verification still needed for generated refresh candidates.

### Documentation

- Define version bumps by the files installed consumers read or copy, with the shard manifest as a development and CI example.
