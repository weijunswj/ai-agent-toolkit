Title: Claude Code keeps agents out of the env edit folder

### Added

- In Claude Code, a Toolkit hook refuses an agent's file reads, writes, searches and listings, and shell commands, that name the env edit folder, an edit file or the env folder as a whole, because the edit file holds your real key values. Reading the names-only manifest and running `toolkit env` commands still work.
