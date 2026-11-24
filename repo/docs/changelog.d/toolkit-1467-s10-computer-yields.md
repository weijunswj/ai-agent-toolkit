### Fixed

- A programme refresh on a computer leaves the sweep lease to a cloud Programme Sweep that is queued or running its refresh job, and says "The cloud sweep picks this up". Back-to-back refreshes after the controller's own writes, each capped at 300 requests, used to re-take the lease within seconds, so the cloud's full-budget pass never ran and new pull requests were missing from task graphs. When GitHub cannot say whether a cloud sweep runs, the refresh runs as usual and says so in one line.
