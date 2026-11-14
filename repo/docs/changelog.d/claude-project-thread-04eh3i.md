### Fixed

- The cloud sweep gate no longer counts a green sweep run that made no pass (queued behind another sweep's lease, main moved, or off the default branch) as the last sweep, so such a run no longer delays the next start by up to six hours. A run paused at GitHub's hourly App limit still counts, so the wait for the reset holds.
