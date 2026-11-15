### Changed

- Validate now runs `check-script-references.cjs`, so a permission row or document that names a missing or retired script fails CI.
- The Projects daily check-in runs the decision trace audit and the CI check-up through `toolkit-controller-check.cjs`, once a day. The hourly nudge skips both (`--skip programme,traces,ci`) and no longer clones the project's repository, so the two tasks stop running the same checks.
