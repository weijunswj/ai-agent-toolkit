### Fixed

- **Programme Sweep footer cleaning after an unverified save:** A cloud sweep pass whose state commit did not read back as written (a `STATE_READBACK_MISMATCH` hold, with no verified state write) no longer reports `refreshed`, so the footer step edits no posts in the governed repository or its evidence store. The pass is still reported as held. A regression forces the read-back mismatch in a real cloud pass and checks that `refreshed` stays unset and footer cleaning is skipped.
