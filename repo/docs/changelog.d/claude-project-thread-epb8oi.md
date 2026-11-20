### Fixed

- **"Couldn't check governance" says why:** the session-start line now names the failed read's cause in a few fixed words, for example "(a read of GitHub ran out of time)" or "(git settings here would send the read somewhere other than origin)", on a computer, in a cloud session and in the shortened cloud line. The cause comes from that start's own read, else the failure this computer's cache recorded. Only fixed phrases are shown, never git's output, a setting's value or a path. Governed effects and standing task auto-merge still hold exactly as before. `status --json` also shows the recorded failure as `merged.refresh_error`.
- **A timed-out read is told apart:** a binding read whose git call was stopped at its time limit, or whose time was already spent, now reports `read-timed-out` instead of `remote-unreachable` or `fetch-failed`, so the line can tell a slow read from a refused one. `status` words it too.
- **Cloud session starts no longer starve later repositories:** a cloud session started above several repositories read them one after another within one 6-second deadline, so a slow first read (a cold network on a resume) left the rest no time and each said it could not check governance. They are now read side by side, each in its own worker thread with the whole deadline.

### Docs

- **Bridge doc cells measured:** the per-place table and the update notice now say what was seen on 20 November 2026: hook scripts run changed code from the next tool call, new hooks and skills need a new session, a session-start change to CLAUDE.md reaches only the next session, over-limit hook text becomes a file with a short preview, the terminal loads the checkout itself, and a real desktop Code chat runs the account copy and hands off.
