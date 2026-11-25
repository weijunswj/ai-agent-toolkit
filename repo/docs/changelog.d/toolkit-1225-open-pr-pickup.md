Title: no open pull request left without an owner

### Added

- **Unowned open pull requests are findings:** in a governed repository the programme sweep raises `PR_UNOWNED` for an open pull request no task in progress owns once it has been open 24 hours, and `PR_RED_UNOWNED` for a red one on the first sweep that sees it. Bot pull requests (the shard refresh, the source-watch notice, dependency updates) and the evidence store's are included; the store's go by age alone. A task owns a pull request it tracks, or one that names it with `Refs` or `Closes`, while that task is in progress; a bare mention or a queued task does not count. Neither finding can be disposed of, and an acknowledgement lasts at most 24 hours, so it comes back daily until the pull request is landed, handed to a task or closed. Both join the stale-work net, so Claude Code's turn-end check stops the controller once for one left 4 hours. The sweep only reports: it never reruns, closes, merges or comments on a pull request.
- **Open PRs in `attention`:** every open pull request of the repository and the evidence store with its owner, its next step or when it is flagged, and the failing jobs of a red one no task owns. It is read live and never stored; a list that cannot be read says so instead of showing a short one.

### Changed

- **Controller rule:** each flagged pull request is routed the same day (landed, handed to a task, asked of the owner, or closed on their OK), and a red one has every job rerun, never only the failed ones.
- **Governance bank, parallel CI shards:** where shards are on, the row says the split is refreshed once a day, and `explain 1.1` says how: one pull request, nothing changes until it is merged, and the programme flags it after 24 hours with no owner.
- **Projects nudge and check-in:** where governance is ENABLED they work out no unowned pull requests of their own; the sweep's findings are the one list. Projects with governance off keep the thread-based check. Project owners refresh their copy as usual.
- **Controller check:** the Open PRs rows of `attention` are not counted or listed as findings.
