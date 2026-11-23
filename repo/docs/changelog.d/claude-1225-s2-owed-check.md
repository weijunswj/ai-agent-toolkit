Title: A turn-end owed check for the controller in Claude Code

### Added

- **Owed check at turn end (Claude Code).** A second turn-end hook, `toolkit-owed-check-hook.cjs`, stops the controller's turn once with the exact steps when the turn leaves owed work: programme findings new for 4 hours or more, or acknowledged past their due time; open `CLOSE_DUE` findings; side sessions the desktop app shows finished but not archived (every pull request merged or closed, not running, nothing waiting on the owner); gate launches from the last 24 hours with no `gate-session` record; and archived gate sessions with no close record. It reads only local files (no git, gh or network call) and stops a turn again only when an entry is added. It stays silent in gate, helper and side sessions, in sessions that did not act as the controller, outside governed repositories and when the host says the stop already follows a hook block. A missing cache, an unreadable transcript or desktop session files in an unknown format become one note, shown once, never a block. Codex keeps the single turn-end hook.
- **Net findings in the attention cache.** `programme.cjs attention` and `refresh` write the open net findings (ID, code, task, kind, state and times; no free text) into this computer's attention cache, which the owed check reads. The owed check starts `programme.cjs refresh` in the background when the cache is missing or over an hour old (at most once per 15 minutes per repository, never in a cloud session).
- **Hook pack.** Rows can use the `Stop` event, and fixtures can plant attention-cache findings (`attention_net`) and desktop session files (`desktop_sessions`).

### Removed

- **Session start shows the governance status only.** The session-start hook no longer prints the attention line, the stale-check line or the cloud "attention and stale check wait" line, and starts no background refresh or stale check; due programme work reaches the controller at turn end. Checkpoint and stale-copy lines stay.
- **The daily stale check is gone.** `toolkit-controller-check.cjs` has no `stale` check, its date stamp (`~/.ai-agent-toolkit/user-state/stale-check/`) is no longer written or read, and the session-start command line for it is gone; the programme sweep raises the same rows as stale-work net findings. `--skip stale` is still accepted and does nothing, for Claude Projects task prompts stored before this change. An existing `stale-check` folder is left on disk unread and can be deleted by hand.
- **The attention cache holds only the net findings.** Its line, counts, digest, work-queue summary and shown-digest fields are gone (schema v2); a cache an earlier Toolkit wrote is not read and is rewritten by the next refresh.

### Changed

- Setup's check of the installed Claude Code hooks now expects exactly two turn-end hooks, the programme checkpoint then the owed check.
- The controller principle **Stale check** is now **Stale-work net**: the sweep raises the rows and the turn-end owed check brings them to the controller. The Claude Projects hourly nudge and daily check-in no longer pass `stale` to the controller check.
- A cloud session that cannot reach the programme store now says the next refresh on the owner's computer reads it.
