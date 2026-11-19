### Changed

- **Programme board shows worked tasks as in progress:** A lane wait, a task waiting only for a free gate lane, is one blocker starting with the word `Queued`. `assign` (plain and `--supersede`) and `reopen` drop lane waits in the same write and keep every other blocker, so a gate start is one write and a task whose gate returned (an accepted G2 waiting for its train) stays `NOW · IN PROGRESS` instead of falling back to `NOW · QUEUED`. Existing lane waits already use the word, so no data changes. A real block must not start with `Queued`.

### Added

- **`QUEUED_BUT_MOVING` work-queue finding:** The sweep raises it for a task shown `NOW · QUEUED` by lane waits alone, with no live gate and nothing waiting on the owner, whose open PR moved to a new head since the wait was written: a gate start's `assign` was missed. Every child write stamps the wait in the task's private part (`lane_wait`: write time and PR head); a patch cannot set it. It is answered by the missed `assign` or `dispose`, never `ack`. A G0, or a G2 with no new push, moves no head, so only the gate start's `assign` covers those.
- **Projects gate route:** The Gate assignments step says how to write a lane wait and to answer `QUEUED_BUT_MOVING` with the missed `assign`.
