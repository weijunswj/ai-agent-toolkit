### Fixed

- **Work queue behind a blocker:** a task natively blocked by a moving task is now left off the work queue for seven days after it last changed, not for ever; after that `TASK_IDLE` is raised and its detail names the blocker. A blocker waiting on the owner counts as moving, as the reconciler guide now says.
- **Work queue on a partial read:** a refresh that could not read every open PR no longer settles open `TASK_IDLE` and `TASK_MERGED_OPEN` findings; they stay as they stand until a pass reads the whole list.
- **Session-start work-queue line:** the longest-stalled task now shows when it was `flagged`, not `since`, which matches the time it prints.
