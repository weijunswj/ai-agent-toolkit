### Fixed

- **Codex start failures read as start failures:** when the system refuses to start a named Codex after the launch is made (for example a script whose interpreter is missing), the app-server request now reports it as a start failure, as it already did for a Codex it refused before launch. `--check --codex` then holds with "cannot be started directly" instead of "did not give a readable answer (not found)". An error after Codex has started is reported as a process error. The Codex config check still returns "not verified" for a Codex the system refuses to run (permission or format errors) and moves on to the next candidate only when the program is missing or refused before launch.

### Tests

- Pinned the opted-in Codex PATH lookup: with only a refused Windows command script on PATH, the error keeps "not a standard npm shim" rather than "not available", and only the value `true` opts in (look-alikes such as `'yes'` or `1` keep the default refusal).
- The Windows shadow-executable test now also plants logging copies in the Codex home, which config/read and runtime probes use as their working folder.
- Renamed two Codex launch tests to say "opted-in Codex PATH lookup" and fixed an escaped line ending in a mocked wrapper script.
