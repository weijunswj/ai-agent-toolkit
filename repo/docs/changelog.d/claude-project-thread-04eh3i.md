### Fixed

- The cloud sweep gate no longer counts a green sweep run that made no pass (queued behind another sweep's lease, main moved, or off the default branch) as the last sweep, so changes and the six-hour refresh are measured from the last pass that did work and the hourly start picks changes up. Activity still waits an hour after the newest run, so a lease held elsewhere never starts a run per edit. A run paused at GitHub's hourly App limit still counts, so the wait for the reset holds.
