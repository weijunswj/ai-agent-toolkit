Title: one ordered work queue on the programme graph

### Changed

- The programme graph has one queue: tasks in flight keep their bands on top (`NOW · IN PROGRESS`, `NOW · AGENT UAT`, `NOW · CLOSE CHECK`), and every other open task is `QUEUED`, sorted on every pass in work order: priority, then quick wins, then all other work, then tasks marked last (`last` or optional). A blocked task keeps its place in the queue with its blocker in Waiting on.
- CURRENT lists only tasks in flight; queued tasks, blocked or not, are in the graph's queue and still count in `Holds`.
- Native sub-issues follow the same order, and graph archive parts use the `QUEUED` group.

### Added

- Optional work-order fields on the parent's task list: `priority` (`P0` or `P1`), `size` (`S`, `M` or `L`, the controller's judgement after evaluating a task) and `after` (tasks this one waits for). A task waiting on a queued task moves to just after it; a loop raises the report-only `DEPENDENCY_CYCLE` and keeps its place.
- `programme.cjs show --queue` prints, read-only, each queued task's place, step and why.

### Removed

- The `LATER` band, the `BATCH_NEXT` work-queue finding and its timers. A parent that still stores a `BATCH_NEXT` finding reads, never counts it as open, and drops it on its next write; old `LATER` and `OPTIONAL` archive parts stay registered and are redrawn empty.
