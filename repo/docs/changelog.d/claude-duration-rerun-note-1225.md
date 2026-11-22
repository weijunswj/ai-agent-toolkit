### Fixed

- **The test duration check says when a failed-only rerun cannot help.** When CI fails a test file over its time budget and that file's newest time is from an earlier attempt than the current one, the failure line now adds which attempt and shard measured it, that the shard passed and was not run again, and that a failed-only rerun reads the same time, so rerun all jobs. Exit codes and checks are unchanged.
