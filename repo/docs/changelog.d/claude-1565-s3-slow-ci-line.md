### Added

- The daily slow-CI line: once a day per repository, this computer runs the CI check-up in the background and tells the owner once when it finds new `speed.shards` or `speed.shards-lopsided` results, at whichever comes first: the next session start (Claude Code and Codex) or the next Claude Code turn end, in a chat the owner started (a desktop side session leaves it for the owner's chat). It stays quiet until the result changes (new times or shard counts are the same result), never waits on the check and never blocks a turn. The record (`slow-ci.v1.json` in user state) keeps workflow paths, finding codes, job names, times and counts only.
- Each background check adds one line to `slow-ci.log` in user state (time, repository, outcome or why it failed); a failed check keeps its reason in the record and the next start backs off 1, 2, 4 hours up to a day. An exclusive lock file lets only one chat start it.
- CI check-up shard findings carry their facts (`facts`: the job, its time, the shard count and the tracked test count, or the two legs and their times) beside the message.
- Hook pack rows prove the line is shown once at session start and at turn end, and not again at turn end after a session start showed it; a side session stays quiet; new `slow_ci` and `desktop_self` fixtures seed the record and a side session, and Stop rows can check the turn-end message.

### Fixed

- The lopsided-shards check no longer reads whole-number version matrices (such as Node 18, 20, 22) as shard indexes: whole numbers count as a split only when they count up by one from 0 or 1.
- The governance bank's "Toolkit instruction copies" row and the governed copies clean-up now say that retired CI shard workflow copies are removed too.
- The bridge doc no longer describes a remembered answer for closed CI shard splits, which Toolkit retired.
- The shard timings refresh reads its one workflow and manifest directly, without a one-value profile.
