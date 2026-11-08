### Fixed

- Codex configuration checks distinguish host refusals from unavailable probes and failed shutdowns without treating executable folder names as configuration errors.
- Codex setup, runtime detection and temporary configuration edits find npm command shims on Windows and start their wrapped program without a shell.
- Toolkit validation reports unused kept terms, and the plain-text check explains when an exemption is no longer needed.
- The Codex launch hold documentation uses platform-neutral wording and checks its reason list against the runtime code.
- Only Codex lookup skips command wrappers it cannot start directly when a working executable appears later on PATH, and start failures retain the specific reason.
- A crashed configuration probe reports that the write is not verified and keeps the written file.
