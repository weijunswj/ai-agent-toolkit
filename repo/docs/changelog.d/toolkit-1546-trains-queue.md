### Added

- Merge trains form a queue: while main's required checks run after a merge, or a train is open, a pull request that becomes ready joins the last open train (`toolkit-merge-train.cjs join`, which reverts the train's bump, merges the joiner and bumps once again without rewriting the branch), or starts the next train behind it once that train has closed. A joiner that conflicts is dropped at once and starts the next train (`find --next-train`). `land` waits while main's required checks run.
- The programme sweep raises `TRAIN_BOARD_DUE` for a ready pull request no train holds while a landing is in flight, and `BOT_PR_OPEN` for a bot's pull request on the first sweep that sees it; both are called out at the controller's next turn end, not after four hours.

### Changed

- `toolkit-merge-train.cjs build` makes the train in a temporary worktree of its own, so the checkout it is run from stays on its own branch; it refuses a branch checked out in any worktree, that checkout included.
- Update Toolkit on every computer that runs the sweep: an older Toolkit holds on a parent document carrying the new finding codes (`attention[n].code is not a known finding code`) until it is updated.
