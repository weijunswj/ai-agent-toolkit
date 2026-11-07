### Added

- A daily no-AI task checks scheduled jobs, reports missing and unhealthy runs, and shares a path-free health file through a verified private evidence store.
- Scheduled task updates cover enrolled and discovered GitHub checkouts under one saved owner approval, with host questions for hand edits and computer ownership.
- A surviving task launcher reports a missing Toolkit checkout and disables its own task after three misses without deleting it.

### Changed

- Setup asks about scheduled task updates in its task section and uses the same guarded updater. Cloud schedules remain coordinator work.
- The existing session task line includes cached health findings and explains when no verified evidence store is available.

### Fixed

- Uncertain GitHub authentication reads defer weekly work visibly instead of treating a failed read as confirmed sign-out.
- Refresh lock takeovers log a plain line, and retry notes survive an exhausted task budget.
- The refresh-wait changelog wording now states the actual bounded wait.
