Title: the programme graph is the work queue

### Changed

- The programme graph is now the controller's work queue. `CONTROLLER.md` says every NOW task always has a working lane, an owner wait or its next step done, and a freed lane takes NOW work first, then LATER by priority.
- The sweep's `TASK_IDLE` finding no longer treats an open PR with no update for 24 hours as moving its task, so work parked behind a stalled PR surfaces.
- The new `TASK_MERGED_OPEN` finding flags a task still shown in progress one quiet hour after every PR merged or closed.
- `TASK_IDLE` and `TASK_MERGED_OPEN` are work-queue findings. They are listed first in `programme.cjs attention` and in the parent's CURRENT block, and counted in the `Attention:` line. They cannot be acknowledged (`QUEUE_FINDING_NEEDS_ACTION`) and never count as waiting on the owner. A disposed one comes back when the task stalls again.
- The Programme Graph's PR cell says `merged` or `closed` when an open task's latest PR is no longer open.
- The Projects hourly nudge reads its lane queue from the programme graph first and raises `WORK QUEUE: <n>` for tasks that need the coordinator's step this turn.
