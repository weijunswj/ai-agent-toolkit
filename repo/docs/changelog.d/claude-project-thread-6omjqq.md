Title: automatic updates on every computer

### Changed

- **Automatic updates are always on:** setup no longer asks about automatic updates, and the bridge no longer takes `--enable-repo-auto-update` or `--disable-repo-auto-update`. A computer with a recorded managed checkout updates it at each session start; a computer that had updates turned off is turned on at its next session start, which records `auto_update_forced_at`. `remove toolkit` is the only way to stop it.
- **A session start with nothing new does almost nothing:** a Claude Code session start whose managed checkout already matches its remote no longer fetches, validates or copies. It reads the hub state, asks the remote once (not at all within 10 minutes of a check that found it current) and runs the install check.
- **The Claude desktop app keeps this computer current:** the app's claude.ai account copy now hands session-start maintenance to the managed checkout's own bridge script, so the checkout, global rules and helper definitions update on a computer that only uses the app. The account-copy reminder waits an hour after the checkout's newest commit, since claude.ai syncs the account copy within minutes. One time only, on a computer whose Toolkit folder predates this release: the app chat asks the owner to say `refresh toolkit` once, which brings the folder up to date and turns automatic updates on.
- **Cloud sessions are quieter:** a cloud session no longer says it runs an uninstalled Toolkit copy; it hears about its copy only when the copy is older than a Toolkit repository in its workspace.

### Added

- **One update notice in the same session:** a session start that moved the checkout tells that session the old and new versions, the changelog titles between them, when to reread the global rules, and when new hooks or skills need a new session.
- **No half-written reads:** an update does not move the checkout's files while the governance hook is reading them at the same session start, and the governance hook waits (up to 15 seconds) for a move already under way. If either is still held off after that, the move waits for the next session start, or that session start has no governance effects.
- **Controller self-update:** the controller health check has a `toolkit` row outside Claude Projects that reports a managed checkout behind its origin branch and names the one command that updates it.
