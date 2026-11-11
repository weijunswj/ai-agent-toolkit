### Added
- When programme refresh repeatedly runs out of time, the next run gives existing child updates a bounded turn before the full scan. Private timing and request counts show where the refresh spends its budget. A child the bounded turn cannot confirm is left to the full refresh in the same run, and a held bounded turn is always followed by a full refresh first.
### Fixed
- Programme state documents are replaced only against the version they were read with. A read that comes back without its version id writes nothing.
- `attention --refresh --json` reports a held refresh as `HELD` with its holds.
