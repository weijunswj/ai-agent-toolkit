### Added

- `repo/scripts/toolkit-controller-check.cjs`: one read-only call runs every Toolkit checker that fits where it runs (the Projects guidebook, instructions, memory and task checks only in Claude Projects; programme attention and decision traces only where governance is on; CI drift and leftover footers for any controller) and prints one line when nothing needs action. Findings come compact, counted by code with the top items; `--expand` prints everything.
- The Projects hourly nudge runs it in its guidebook step, so each run also covers decision traces, CI drift and leftover footers, and a new `CONTROLLER CHECK` first-line prefix names what needs action.
- `CONTROLLER.md`: a controller runs it at session start and on each periodic run instead of recalling state from memory.

### Fixed

- The decision-trace audit and the footer sweep read GitHub lists by numbered pages, so they also run in cloud sessions, whose proxy refuses the numeric-ID next-page links that `gh api --paginate` follows.
