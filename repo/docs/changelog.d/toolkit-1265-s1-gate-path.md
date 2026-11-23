Title: Gate endings that can always be recorded

### Added

- After the owner answers a gate question, the controller records the answer on the same return: `return --consume <id> --verdict ACCEPT|REOPEN --reason <the answer>` works once on the newest return consumed `WAITING_OWNER`, while the gate still waits at the same epoch and assignment. Before, the only way out was a reopen and a new return ID. A holder order's `return` write takes the same `reason`.
- Every consumed return is logged with its time in the task's gate trail (`private.gate_history`), so a later check can tell when a plan was accepted.

### Fixed

- A G2 return is accepted only when the task PR carries a `Toolkit-G2: PASS` verdict for the return's head from an account that can write to the repository, read with the merge train finder's own parser and trust rule. The accept records that PASS in the task's review in the same write; a FAIL at that head allows only a send-back, which records it as not passed. Before, a G2 could be accepted with no verdict at all.
- A G2 accept closes the builder's older return in the same write (accepted when it was at the passed head, sent back otherwise), so it no longer stays open for good after the G2's supersede.

### Changed

- A lane wait is now only a blocker starting `Queued in NOW:`. Other blockers that start with `Queued`, such as a queue label `Queued 1 - after Alpha2`, are real blocks that `assign`, `reopen` and a consume send-back keep. Older lane waits in another form are not matched: rewrite each to the new form or keep it as a real blocker.
- The reconciler's Gates rule now says a G2 recheck is a `reopen` only with no G1 round between; after a G1 round it is `assign --supersede`.
