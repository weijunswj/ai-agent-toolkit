### Fixed

- **Logged acceptance clears the closed-without-acceptance finding:** refresh no longer raises `CLOSED_WITHOUT_ACCEPTANCE` for a completed close whose controller-logged review `PASSED` has passing verdicts at the tracked PR head (with no head tracked, the newest verdict) and whose UAT is `NOT_REQUIRED`, `PASSED` or `UAT_RETAINED` at that head. Before, only an accepted G1 or G2 gate counted, so a disposed finding came back as new whenever the attention list's size cap evicted the disposal.
