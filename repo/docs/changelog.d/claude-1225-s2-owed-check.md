Title: A turn-end owed check for the controller in Claude Code

### Added

- **Owed check at turn end (Claude Code).** A second turn-end hook, `toolkit-owed-check-hook.cjs`, stops the controller's turn once with the exact steps when the turn leaves owed work: programme findings new for 4 hours or more, or acknowledged past their due time; open `CLOSE_DUE` findings; side sessions the desktop app shows finished but not archived (every pull request merged or closed, not running, nothing waiting on the owner); gate launches from the last 24 hours with no `gate-session` record; and archived gate sessions with no close record. It reads only local files (no git, gh or network call) and stops a turn again only when an entry is added. It stays silent in gate, helper and side sessions, in sessions that did not act as the controller, outside governed repositories and when the host says the stop already follows a hook block. A missing cache, an unreadable transcript or desktop session files in an unknown format become one note, shown once, never a block. Codex keeps the single turn-end hook.
- **Net findings in the attention cache.** `programme.cjs attention` and `refresh` also write the open net findings (ID, code, task, kind, state and times; no free text) into this computer's attention cache, which the owed check reads.
- **Hook pack.** Rows can use the `Stop` event, and fixtures can plant attention-cache findings (`attention_net`) and desktop session files (`desktop_sessions`).

### Changed

- Setup's check of the installed Claude Code hooks now expects exactly two turn-end hooks, the programme checkpoint then the owed check.
