### Added

- The controller enforcement map now also covers the gate rules, and each row carries the hash of its rule line: an edited controller or gate rule fails the map check until its row is reviewed and the hash updated.
- An instruction-only row now says its basis: judgement (no code can decide it), host-gap (the host lacks the event, with a line saying how to test for it now) or planned (with the slice that builds it). `--list host-gap` prints the host-gap rows for a hooks or setup review.

### Fixed

- Seven out-of-date reasons in the map: three rules a hook or script already enforces are now mapped to it, and four reasons now name the slice or host gap that applies.
