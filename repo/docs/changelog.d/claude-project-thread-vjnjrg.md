### Fixed

- **Merge trains re-read each member's UAT line:** `toolkit-merge-train.cjs land` now reads each member's live pull request body and refuses when the auto-merge check calls its `UAT:` line missing or invalid, or when the manifest records `NOT_REQUIRED` or `PASSED` while the body says `OWNER_TEST_NEEDED`. A stale or hand-built manifest can no longer drop an owner's test at merge; a stricter manifest line still lands and keeps the test owed. A `--live` member entry with no body is refused, never read as `NOT_REQUIRED`.
- **The train finder says why a UAT line fails:** its skip reason now ends in `(missing)` or `(invalid: <why>)`.
- **PR sweeps flag invalid UAT lines:** the Projects hourly and daily PR sweeps now flag `invalid UAT verdict` as well as `missing UAT verdict`, judged by the auto-merge check rather than by a line starting `UAT: `.
