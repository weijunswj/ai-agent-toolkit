Title: A close-due finding for each finished gate session

### Added

- **Gate sessions are recorded.** `assign` and `reopen` open an entry for each new gate assignment in the task's private state, and the controller records the gate's host session right after the launch with `programme.cjs gate-session --issue <n> --assignment <id> --host <host> [--host-session <id>]`, then its close with `gate-session --closed`. Each host's value and where its session ID comes from are in the host contract (section 10). A controller session is never recorded as a gate's, and holder orders can carry `gate-session`.
- **`CLOSE_DUE`.** The sweep raises one finding per finished gate assignment whose session is still open: no longer the live assignment and, for a G1, every PR it returned merged or closed with no UAT owed there (or the agent's UAT handed on). It is part of the stale-work net, is never disposed and is acknowledged for at most 72 hours. It resolves once the close is recorded. `programme.cjs attention` shows the host and session beside it; the session ID stays in private state and never reaches a page, a finding detail or the session-start cache.

### Changed

- The controller principle **Close what you spawn** asks for each gate's session to be recorded at launch and its close when closed, and the enforcement map now names the sweep as its check for gate assignments.
- Update Toolkit on every computer that runs the sweep: an older Toolkit holds on a parent document carrying `CLOSE_DUE` (`attention[n].code is not a known finding code`) until it is updated.
