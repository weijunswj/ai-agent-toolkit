Title: leaner child filing rules

### Added

- **Automate first:** a new global development principle: clear-cut rules are enforced in code (hooks, scripts, CI) first, then in writing, and memory last; controllers still decide judgement calls. It replaces "Checks over judgement".
- **Daily stale sweep:** `toolkit-controller-check.cjs` has a read-only `stale` check that runs once per local date per repository (a local stamp file) where governance is on, and lists children whose PRs merged for the controller to judge against their DONE WHEN (`JUDGE?`; only children it judges done reach the owner as `CLOSE?`) when nothing on them is still open (not acknowledged by the controller, no lapsed hold, no `Kept open:` line, no open sub-issue, no unchecked DONE WHEN row), fold (`FOLD?`, a new child with no `Nearest child:` line), move (`MOVE?`, closed but holding open work) and a full or over-cap polish child, as one owner-approve list; every row prints, and a same-day run shows the day's list again. The Projects daily check-in runs the same sweep through GitHub MCP; the hourly nudge never runs it.
- **Agent UAT first:** `toolkit-pr-body.cjs` refuses a body that asks for owner UAT (`UAT: OWNER_TEST_NEEDED`) without exactly one visible `Agent UAT: PASSED (<evidence>)` line; a merge train with an owner-test member writes that line naming those members. Owner UAT asks list only the steps no tool reaches, each with why.

### Changed

- **Reuse first is hard:** work and findings go on their area's open child; a new child carries a `Nearest child:` line naming the closest open child and why it does not fit.
- **Lows:** a one-line G2 Low in the PR's own files is fixed with the PR's next fix round; every other Low and small UAT nit is a row on one rolling Later polish child (at most 8 rows), which ships as one batched PR when full. From a PR's second G2 round, open Mediums join their area's Now child.
- **Agent UAT:** at every tier that needs UAT, agent UAT runs every step a tool reaches before the owner gets the rest.
- **Trims:** "Never silently wrong" drops its must-hold clause (Automate first now says it) and "Written, not remembered" drops "never only in chat or memory" (memory last covers memory).
