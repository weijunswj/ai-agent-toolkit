Title: lane waits removed

### Removed

- Lane waits: a blocker starting `Queued in NOW:` is no longer special. `assign`, `reopen` and a consume `REOPEN` keep every blocker, results no longer carry `dropped_lane_waits`, child writes no longer stamp `private.lane_wait`, and the `QUEUED_BUT_MOVING` work-queue finding and the PR head commit time it read are gone. A task waiting only for a free lane stays planned in the queue with no blocker.
- A parent that still stores a `QUEUED_BUT_MOVING` finding reads, never counts it as open, and drops it on its next write; a stored `private.lane_wait` stamp still reads, and the controller's one clean-up order removes it with the old blockers.
