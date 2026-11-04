### Fixed

- The CI check-up now reports a failing command hidden by a later `exit 0` line in PowerShell and cmd steps.
- The CI check-up decides whether a job runs on Windows only from its runner labels or the matrix values it names, so a step called "windows documentation" no longer makes a Linux job look like a Windows job. A runner it cannot resolve is reported for a person to check.

### Tests

- The external operation preflight tests now cover blank authority fields, empty target lists, secret patterns and key names, and secrets nested under secret-looking keys, and check that no secret value is echoed.
