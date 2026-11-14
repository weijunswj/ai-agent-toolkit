Title: Threads self-check CI waits

### Added

- **Threads waiting on CI arm their own check-in:** the Projects managed block tells every thread to arm a check-in about 15 minutes out before ending a turn that waits on CI or any outside event, instead of relying on that event alone. The Projects skill tells every brief to say so.
- **Hourly nudge flags quiet CI waits:** a new step runs on every nudge, the no-change path included. It lists each thread quiet for 20 minutes or more whose pull request CI is still pending, or finished after the thread's latest message, under `CI WAIT QUIET`, and the coordinator pings each one that turn. The same thread listed again on the next run goes to the owner.

### Changed

- **Projects wording trims:** a few managed-block and skill lines are shorter, with no rule dropped, to keep both under their byte caps.
