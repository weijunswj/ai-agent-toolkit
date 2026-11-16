Title: work in batches

### Changed

- Work now moves from Later to Now in batches. Lanes finish the Now batch first (fixes, then reviews, then other steps), then the controller reads all of Later and picks the next batch: the highest priority tier first, then the quickest tasks, at most 6 PRs and one large task. A tail guard stops one slow task from holding the next batch. `CONTROLLER.md` "Work queue" and the delivery contract's new "Work in batches" part say the same rule; the delivery contract defines the priority tiers (P0 to P3), sizes (S, M, L), when a batch is done, lane order, parking and jumps.
- The `order` field's description says how the controller sets it: Later reads priority tier, then size, with the picked batch first.

### Added

- The reconciler raises a new work-queue finding, `BATCH_NEXT`, on the programme parent when the graph has a Later task and no Now task needs a gate lane, after one quiet hour (only the first raise waits, so a routine task write never drops a dispose). A Now task needs none while it waits on the owner, its open PR passed review at its current head with no red required check, every PR on it has merged or closed, or it has been still for a day (the tail guard). Like the other work-queue findings it is answered by acting or a dispose, never acknowledged, and it clears by itself once a task takes a lane. It reaches the session-start attention line, `programme.cjs attention` and the Projects hourly nudge's `WORK QUEUE` prefix.
- The Projects hourly nudge lists the graph's Later rows as queued work only once `BATCH_NEXT` says no task in progress needs a lane, and works project memory's queue the same way.
