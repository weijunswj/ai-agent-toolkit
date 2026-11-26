### Changed

- **Governance bank as one table:** `toolkit governance` now shows one table: 1.1 GitHub governance and 1.2 Task auto-merge with merge train, the only two questions, then the parts Toolkit keeps itself: parallel CI shards, Toolkit permissions, the Governance App and the evidence store. Each part is marked Ready, Not ready or Unknown with its one next step while governance is on, and the top line says `ON, ready` or `ON, not ready, n steps left`. The parent issue and required checks are one line under the table, and merge trains show in row 1.2. A part takes no answer: replying to its row says how it changes instead, and the evidence store's other choice is the controller's state move, never this answer.
- **Unknown is never missing:** when GitHub cannot be read, even for one of the App's two reads, the Governance App row is Unknown and the answer gives no setup line; a CI time that could not be read, or a programme file that could not be read, leaves the shards and store rows Unknown too, and an unknown part is never counted as a step left. A missing App holds no governance action; only the cloud jobs that need it do nothing.
- **Shards not applicable:** where Toolkit cannot split the tests (no Node tests, such as a Python suite), the shards row says not applicable with the reason, and no answer turns shards on there. Fast CI says not needed.

### Added

- **Permissions line at session start:** while this computer's Toolkit permission lines are out of date, a governed repository's session start carries one line for the agent to pass on once, naming `toolkit permissions`. Nothing waits on it, and cloud sessions are not checked.
