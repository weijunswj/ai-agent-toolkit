Title: stuck threads get a fresh successor

### Added

- **Stuck threads get a fresh successor:** the Projects hourly nudge now runs `repo/scripts/toolkit-projects-stuck.cjs` every run (step 4a) on what it read: every `list_threads` page, each unresolved work thread and each Remote Control lane's status. A thread is stuck when its Remote Control session ended, or is not connected or served with the session quiet 10 minutes or more while its device is reachable, or when it was failed, stopped or idle while owing work and did nothing of its own after the coordinator's message. A failed or stopped thread gets a continue message first, because a usage-limit or API-error cut-off leaves that state and such threads continue on one message. A working thread, one whose run left output in the last 45 minutes, and one waiting on something recorded (an open owner card, CI, a gate or review) are never stuck; a working thread quiet past twice its expected time goes to the owner instead. The report carries `STUCK THREADS`, `STUCK FOR OWNER` and `STUCK CHECK FAILED` prefixes, and a cut-off thread scan reads `THREAD SCAN INCOMPLETE`.
- **The coordinator starts the successor itself:** `Successors for stuck threads` in the Projects skill's periodic-runs reference covers the re-check, the successor brief (the old brief with its gate route, the pushed state and a stop when the branch moved), a fresh Remote Control session for Remote Control lanes, the "superseded" message to the old thread and a ledger (`successors.json`) that holds each lane to one successor in 2 hours. A parked Remote Control lane now gets a successor before the owner is asked to type in it.

### Changed

- **Hourly nudge default tier:** the hourly nudge now defaults to the mid tier (Sonnet on Claude) instead of small, because the small tier missed threads in its lane sweep. A stored nudge prompt keeps its own tier until it is swapped.
- **Task kind check:** `toolkit-projects-tasks.cjs --check` now reads a pointer that loads another task kind as malformed, instead of relying on a tier mismatch to catch it.
