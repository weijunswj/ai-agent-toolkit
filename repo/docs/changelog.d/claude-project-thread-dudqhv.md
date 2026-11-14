Title: Projects tasks load their instructions every run

### Changed

- The daily check-in and hourly nudge now store only a short pointer, their params block and the project additions. Each run clones Toolkit main and prints its instructions with `toolkit-projects-tasks.cjs --expand <kind> --params <file>`, so a Toolkit release reaches every project's tasks on their next run with no rebuild.
- `--check` compares the pointer's text, not its version stamp, so a release alone no longer marks tasks outdated. A prompt that still stores the full instructions checks `outdated`, and `--refresh` turns it into the pointer, keeping its params and project text byte for byte.
- An outdated task is now swapped in place with `update_trigger`, keeping its id, run history, schedule and home thread. A task is recreated only to move it between bound and fresh.
- The Toolkit project's daily check-in reports `PROJECT TASKS OUTDATED` for another project's enabled check-in or nudge that is not a current pointer, and its coordinator swaps those in place, prompt only. Disabled tasks are listed and left alone.
- A run that cannot load its instructions posts `TASK LOAD FAILED` in its home thread instead of running from memory.
- `--expand` reads params tolerantly: it drops keys it no longer knows and migrates pre-tier values, so a pointer stored by an older release still loads.
