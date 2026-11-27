### Added
- The Projects daily check-in rebinds itself when `repo/CONTROLLER.md` changes. `toolkit-projects-tasks.cjs --rebind <memory file>` compares main's CONTROLLER.md in the check-in's fresh Toolkit clone with the BINDING memory line and prints the exact new BINDING line, each changed section with its added and removed lines, and the commits that changed it. The coordinator rewrites the line and reports what changed the same turn; `BINDING UNKNOWN` still reports its reason.

### Changed
- The daily check-in routes its findings: its own Projects steps (the rebind, guidebook, block, Toolkit memory lines, tasks, nudge and run relay) stay with the Projects coordinator, another controller of the repository gets only GitHub-side controller work in its own lane, and the owner only their own steps.

### Removed
- The controller check no longer runs the decision-trace audit, so the daily check-in no longer raises `TRACE GAPS` or "unlinked decision comments". Decision records are comments on their issue, listed by `programme.cjs trace`; the audit stays a standalone tool for pages an older Toolkit wrote. A stored prompt or older guidebook copy that still passes `--skip traces` keeps working.
