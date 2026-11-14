Title: merge card readiness and slice 4 review fixes

### Added

- `repo/scripts/toolkit-merge-card-ready.cjs` tells the merge thread when it may post the owner's merge card: the head is unchanged, the body's UAT line lets it merge, and the newest Validate run on that head is green. Run again with `--body-sha` after the tap, it refuses to merge if the body changed since the card.
- The Projects controller skill has a merge card reference: fix eligibility lines and every other body edit before the card, and edit nothing on the pull request after the owner's tap until it lands. The PR review playbook says the same.

### Fixed

- With no push key, the re-bump workflow no longer calls a freshly re-bumped pull request stale: a head that already contains main is current. It reads only pull requests into main, and every page of the list and of each pull request's files.
- When the programme sweep gate cannot read the held streak after starting the sweep, its message now says the sweep started.
- A held streak counts across runs that made no pass (queued, paused at the App limit, main moved, off the default branch; each now leaves a `Programme Sweep no pass` notice) and across changed hold codes, and its alert names when the streak began.
- The fallback risk audit shows at most nine annotations per severity and a tenth that says how many more are in the log, so GitHub's limit of ten per step no longer hides the rest silently.
