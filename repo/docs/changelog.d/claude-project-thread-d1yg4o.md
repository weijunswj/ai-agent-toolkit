### Fixed

- **Governance answer:** the shell can no longer give the governance answer by putting the decision word after other options, run Toolkit's governance proposal code itself, or reach Toolkit's user state by changing into its folder first. This holds in every folder, with or without a merge hold.
- **Undecided governance:** the governance state no longer carries the old `hold` flag, and the command line, hook comments, gate rules and bridge doc now say that an undecided repository counts as off and nothing waits on the answer.
- **Remove Toolkit:** a changed scheduled task that no longer carries Toolkit's marker can no longer be named with `--include`, and the plan tells the owner to delete it in Task Scheduler instead of offering `--include`.
