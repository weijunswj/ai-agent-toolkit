### Fixed

- The controller handoff snapshot now follows memory saves made by any tool. The after-tool hook compares the snapshot's remembered sources with what the session holds after any tool call but a read-only one, so a host memory tool, a shell edit or a tool it has never seen all count, and a change inside the 10-minute window is picked up by the next call after it.
- A session with no earlier handoff run, such as a fresh cloud container, finds the snapshot in a nearby store checkout and readies a fresh shallow clone before refreshing it.
- A hook-started refresh writes only files newer than their snapshot rows (each row now records its file's modified time), so a session holding an older memory copy never overwrites newer memory. Where a folder's times are not real, only the session's own changes are written. A manual run still copies everything.
