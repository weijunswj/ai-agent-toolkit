### Fixed

- The hourly programme sweep tells "offline" apart from "gh not signed in": when `gh auth status` fails, one short connection to github.com decides which, so a network outage no longer reads as a sign-out.
- Skipped sweep runs are no longer invisible. Each skip is counted in a row in the run's record, the session-start line in that repository shows `Programme sweep: skipped (<reason>), N runs in a row since <time>; see toolkit tasks.` (also for a failed run or no run for over 2 hours inside the sweep's hours), `toolkit tasks` shows the reason and count, and the first good run after them notes `Resumed after N skipped runs since <time> UTC.` Skips still exit 0.
