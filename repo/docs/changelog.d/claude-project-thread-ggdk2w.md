### Fixed

- **New session after an update:** `setup toolkit` and `refresh toolkit` now end with a `## Start a new session` line naming each app (Claude Code, Codex, Antigravity) whose skill files or rules the run changed, because sessions already open keep using the old files; Codex, for one, keeps the old plugin folder's skill paths. Nothing is printed when the run changed none.
