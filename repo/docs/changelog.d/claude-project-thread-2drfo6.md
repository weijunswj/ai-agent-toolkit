Title: Projects scheduled tasks become pings

### Changed

- The Projects daily check-in and hourly nudge are now pings: each run stamps itself and posts one line in its home thread, and the coordinator works the task's checklist from the guidebook copy that turn. Steps that need a shell, GitHub or scheduled-task reads are labelled `TOOL STEP` and go to a thread that has those tools; `tasks/ping-run.md` tells the coordinator how to read the checklists.
- `toolkit-projects-tasks.cjs --render` renders the ping for both Toolkit tasks; `--check` reads a ping as current and a pointer or full prompt as outdated. Until a task is swapped, `--expand` prints the ping with a `TASKS OUTDATED` prefix, so an unswapped pointer runs as a ping and asks for its swap. A project's own (custom) task is unchanged.
- A Toolkit task's project additions move to `<report_dir>/project-additions.md`: `--additions-from` prints them and `--refresh` refuses until `--additions-saved` shows them saved word for word.
- `toolkit-projects-run-missed.cjs` also checks each run's receipts when given them: `RUN PENDING` (never relayed, or not finished by the next fire), `RECEIPT BROKEN` (`.done` without `.relayed`, or an empty receipt) and `RECEIPT ORPHAN` (receipts with no stamp). Input without receipts gives the same output as before.
- A scheduled run the controller defers or pauses gets one notified owner line (why, and when it resumes), as does a missed or stuck run and a run whose result needs the owner; a normal start is not notified. Scheduled run work never takes or waits for the gate lane.
