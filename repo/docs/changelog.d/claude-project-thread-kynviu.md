Title: UAT verdict on every pull request

### Added

- Every pull request body now carries one `UAT:` line that says whether the owner has to test the change: `UAT: NOT_REQUIRED (reason)`, `UAT: OWNER_TEST_NEEDED (what the owner tries)` or `UAT: PASSED (the owner's OK)`. The plan proposes it, the builder writes it and the reviewer confirms it. The portable Git completion playbook holds the format.
- The task auto-merge check reads that line: `toolkit-auto-merge-eligible.cjs --base <SHA> --head <SHA> --body-file <file>`. A pull request with no line, a malformed line or an owner test still open now exits 1 and names the reason (`Missing UAT verdict`, `UAT verdict invalid`, `Owner test needed`) together with any merge-rule path, so a finished pull request no longer waits in silence for an answer nobody was asked for.
- The hourly nudge and the daily check-in list a ready pull request with no `UAT:` line as `missing UAT verdict`.

### Changed

- The check no longer answers when it is called with neither `--body-file` nor `--scope-only`: it exits 2 with its usage, so an older habit cannot read a scope-only pass as merge readiness. `--scope-only` keeps the previous scope report and says it grants no readiness. The merge hold is unchanged and still checks scope only.
- A missing or invalid line goes back to the gate that owns the pull request and is never turned into a question for the owner. Only the owner's own answer turns `OWNER_TEST_NEEDED` into `PASSED`.
