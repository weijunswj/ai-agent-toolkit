Title: every open PR attended

### Changed

- **Hourly nudge checks every open PR:** the PR step now runs every hour, even when nothing else changed, because a bot or workflow PR wakes no thread. It covers the repository and the project's evidence store, gives each open PR its owner and live next step, and flags any PR with neither as `PR UNOWNED` on the report's first line.
- **Daily check-in flags unowned PRs:** its GitHub step also covers the evidence store and lists an open PR that no thread owns or watches and no merge train holds under `PR ATTENTION`, with the reason `unowned`.
- **Coordinator routes unowned PRs the same turn:** the periodic-runs reference says how: a reviewed green PR goes to the merge train, anything else to its builder, a reviewer or a fresh lane, or a close with the reason after the owner's OK. The Projects skill now says every open PR, bots' included, needs an owner and a next step.
