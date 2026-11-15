### Fixed

- The CI check-up's `speed.edits` row, on a workflow with a route job, again flags ungated jobs without a matrix when they outnumber the jobs the route gates (the route and the `!cancelled()` or `always()` aggregates are not counted), and no longer calls a job that the route gates itself "skipped too".
