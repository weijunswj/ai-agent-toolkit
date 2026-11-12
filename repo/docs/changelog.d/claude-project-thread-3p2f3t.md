Title: faster setup and refresh

### Changed

- Setup and refresh skip the Windows scheduled-task update while nothing it depends on has changed (Toolkit version, approval, task registry, discovered checkouts and each checkout's cached governance read) and the last clean update is under 24 hours old, and say so: `Scheduled tasks: unchanged since <time>; not rechecked.` The direct `toolkit update scheduled task` always checks in full.
- When the scheduled-task update is held, setup names each held row and its reason, so agents no longer run the slow direct plan again to find out why. The `toolkit-setup` skill tells agents not to run that plan during setup or refresh.
- A checkout whose cached governance read is fresh, certain and enabled is used without a network refresh or a wait for the refresh lock.
- The scheduled-task plan reports `timings_ms` per step and checkout, and setup prints `Scheduled tasks checked in N s.`

### Fixed

- Linked worktrees under the GitHub folder are no longer discovered as checkouts, so they no longer hold every scheduled-task update (and every setup) on the computer.
