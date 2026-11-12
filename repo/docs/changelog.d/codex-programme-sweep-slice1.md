Title: programme sweep on a saved queue, and on GitHub

### Changed

- The programme refresh now works through a saved queue on the one reconciler. Each pass reads the whole graph, then the tasks GitHub changed since the last pass, tasks whose page shows another revision than their state, open tracked PRs whose head or checks moved, and a rotating share, so every task is read at least once in twelve passes. It saves the state in one commit, keeps every recovery step it had, and a pass that changes nothing writes no state.
- Requests run one at a time within a cap of 300 per pass, keep a reserve for saving and redrawing, and stop reading when GitHub's rate limit runs low or asks to wait. When GitHub refuses GraphQL, the state is read one document at a time instead.
- CURRENT on the parent page starts with when the board was last updated, or how long it has been out of date, why, and how many tasks are still to check.
- `reconcile --apply` saves its state phase in the same single commit.
- The hourly sweep pass (`refresh --scheduled`) now works for up to 50 minutes instead of 10, is killed at 55 minutes and, on GitHub, has its job stopped at 58, so it always ends before the next hourly start. The refresh a session starts after its own GitHub write keeps 10 minutes and still leaves a flag for the scheduled pass while that holds the lock.
- On a computer, the hourly task's budget rises to 55 minutes and its Windows stop-after limit to 56; the refresh in it takes what is left, less the attention step, and never less than 10 minutes. A task registered with the earlier 30-minute limit is updated in place by the next apply. A long pass renews its sweep lease.

### Added

- The hourly Toolkit Programme Sweep workflow runs the refresh on GitHub under the governance GitHub App, with one installation token for the governed repository and one for its evidence store, each with only its own permissions. Without the App it posts a notice and writes nothing; a repository whose state is on a public branch keeps the computer's sweep.
- A shared lease in the evidence store lets one sweep write at a time across the computer and GitHub; a run stopped by its timeout is reported by the next one.
- `repo/contracts/cloud-jobs.json` lists the jobs that run on GitHub and their tokens, and `toolkit governance check` lists them beside the App's setup.
