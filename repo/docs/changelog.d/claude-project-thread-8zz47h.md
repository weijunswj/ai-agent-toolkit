### Fixed

- **Programme graph current step:** while a task's gate is assigned or active and not blocked, the parent graph's Waiting on cell names that gate first and shows any owner test still owed after it (`G1, then Owner: UAT on PR #<n>`), instead of showing the owner test as the current step. CURRENT's In progress line ends `then your UAT on PR #<n>` in that case. A submitted, interrupted or finished gate, a blocked task or an owner decision keep the old order.
