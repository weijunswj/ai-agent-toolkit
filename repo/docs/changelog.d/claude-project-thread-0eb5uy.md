Title: Coordinator resolves finished threads on relay

### Changed

- The Projects coordinator now resolves a finished thread in the turn it relays the thread's final result, including when the thread's pull request merges or closes. The hourly nudge becomes the backstop rather than the only resolve path.
- The hourly nudge lists a finished thread even when it cannot prove the result reached project chat, marked "relay unverified", so the coordinator relays the one-line result and resolves it instead of the thread staying open.

### Added

- Hourly nudge first-line warnings `RESOLVE DUE: <n>` (finished threads waiting to be resolved) and `THREAD SCAN INCOMPLETE: <read> of <total>` (the thread sweep did not cover every open thread, so its "none" cannot be trusted).
- The nudge keeps its resolve candidates in its state file and repeats them on a no-change run until they are resolved.
