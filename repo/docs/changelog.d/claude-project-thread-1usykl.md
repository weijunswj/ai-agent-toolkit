### Added

- Stable repository minutes for Windows scheduled jobs, with a warning when more than nine repositories share the available minutes.
- Recorded job-owner computers and a local programme lock to serialise scheduled store and programme writes, with logged stale-lock recovery.

### Changed

- Hourly cleaners start at their repository minute and run for 24 hours. Governed shard timing runs on Monday mornings at the same minute after 08:00.
- Exact earlier Toolkit task definitions migrate in place while owner stops and hand edits remain protected.

### Fixed

- The governance hold allows the managed checkout's exact default-folder commands for independent footer tasks while retaining holds on governed tasks and unrelated commands.
- A first programme sweep without parent state skips with plain instructions for the appointed controller to initialise it in the private evidence store.
