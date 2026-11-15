### Fixed

- **Merge trains never undo main:** `verify` (and so `land`) now refuses a merge train whose tree differs from a fresh build of its current members on main, and `catchup` and `eject` check their own result the same way, leaving the train as it was on a difference. An eject revert keeps removing its content through later merges, so a change that reached main another way (the ejected member landing alone, a pull request built on it, or an identical change from another pull request) could be deleted when a green train landed. The check compares results, so every such route is closed for a merge onto the main it checked; a refused train is rebuilt on main.

### Changed

- **Governed default branches require branches to be up to date:** the ruleset Toolkit writes now requires a branch to hold the default branch's latest commit before it merges, and `toolkit governance check` reports a default branch that does not require it (`PROTECTION_UP_TO_DATE`), which `migrate` offers to fix with that ruleset. A check that passed at the head then still holds for the merge, which closes the gap between a merge train's `land` and its merge.
