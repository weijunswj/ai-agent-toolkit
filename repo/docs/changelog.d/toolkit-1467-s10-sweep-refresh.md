### Fixed

- The programme sweep after a merge refreshes the board again. A pass whose lease release met a race on the evidence store branch used to drop the release without a word, so the lease stayed live for up to twenty minutes and every sweep started for the next merge logged "queued" and ended green with nothing refreshed. The release now reads again and tries up to three times; one that never lands says so, and the next sweep reports that pass as stopped.
- A cloud sweep that meets another sweep's lease waits for it, checking every minute for up to 30 minutes, then runs its pass with the time left. A run that never gets the lease fails instead of ending green, and starts one more run at once.
- `toolkit governance status` reads the merged binding once more with a longer budget when the first read ran out of time, so one slow fetch of a large default branch no longer holds every programme command.
