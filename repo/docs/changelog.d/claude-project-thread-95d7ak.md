### Fixed

- **Merge trains in the programme graph:** a merge train pull request is now a carrier. It no longer joins each member task's PR history, gets PATH and STATUS blocks written into its body, wins merged PR backfill over its member on an exact merge time tie, or shows as a PR without a task.
- **Issue closure after a merge train:** the closure check no longer holds an issue because a merged train's one UAT line waits on another member's owner test. It releases the issue only when every member the train carried that references it owes nothing by its own strict UAT line and is not named as owing the test; a member with no strict line, a member merged apart from the train or a pasted member table keeps the hold.
- **Merge train body:** each link line names its member and that member's UAT state, and every member's `## Pack changes` lines (new manifest field `pack_changes`) are copied into the train body, so CI's hook pack check accepts rows a member already explained.
