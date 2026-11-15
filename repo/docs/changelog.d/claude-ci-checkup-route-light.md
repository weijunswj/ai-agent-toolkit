### Fixed

- The CI check-up's `speed.edits` row accepts a route job that reads the event and sets an output the test jobs need and skip on, so the Toolkit's own Validate workflow no longer shows a false finding. It still flags a route job that gates no test legs, and now also flags a job that needs a route-skipped job without `!cancelled()` or `always()`, because a required check on it would never pass after an edit.
