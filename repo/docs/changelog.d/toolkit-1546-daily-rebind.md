### Added
- The Projects daily check-in rebinds itself when `repo/CONTROLLER.md` changes. `toolkit-projects-tasks.cjs --rebind <memory file>` compares main's CONTROLLER.md in the check-in's fresh Toolkit clone with the BINDING memory line and prints the exact new BINDING line, each changed section with its added and removed lines, and the commits that changed it (merge commits left out). The coordinator rewrites the line's commit, blob, toolkit version and date the same turn, keeping the skill Version a `SKILL UPDATE` may have recorded that turn, and reports what changed; `BINDING UNKNOWN` still reports its reason. `--check-memory` and `--rebind` read the BINDING line alike: a tab, no-break space or zero-width space in it is named (`MEMORY FORMAT: BINDING has a character outside printable ASCII`) so the line gets rewritten.

### Changed
- The daily check-in routes its findings: its own Projects steps (the rebind, guidebook, block, Toolkit memory lines, tasks, nudge and run relay) stay with the Projects coordinator, another controller of the repository gets only GitHub-side controller work in its own lane, and the owner only their own steps.

### Removed
- The controller check no longer runs the decision-trace audit, so the daily check-in no longer raises `TRACE GAPS` or "unlinked decision comments". Decision records are comments on their issue, listed by `programme.cjs trace`; the audit stays a standalone tool for pages an older Toolkit wrote. A stored prompt or older guidebook copy that still passes `--skip traces` keeps working.
