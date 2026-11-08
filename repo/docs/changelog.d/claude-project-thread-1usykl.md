### Added

- Refresh copies GitHub closes and reopens into programme child state and adopts newly observed native tasks at the end of Later.
- Task pages and the programme graph show all discovered pull requests, including merged commit links. Unlinked pull requests raise an attention finding, excluding known bots.
- Findings left new for 24 hours appear in a waiting list for the owner.

### Changed

- Child state uses a versioned schema; existing child documents remain readable and upgrade on their next changed write. Older readers hold rather than misread the new documents.
- Refresh shares a bounded PR discovery budget and retains its history and private close watermark when discovery is incomplete.

### Fixed

- A copied completed close without accepted completion now raises a specific finding without inventing review or user acceptance.
- Reopened sweep-closed tasks regain their previous lifecycle once; an unchanged second refresh writes nothing.
