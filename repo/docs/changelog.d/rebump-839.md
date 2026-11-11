Title: Programme refresh reads only what changed

### Added

- Programme refresh reads only what can have changed. One request for the parent's sub-issue list replaces a read per child, empty comment and sub-issue lists are not requested, the parent's comments are read from a bookmark, and a settled child that has not changed reuses its last comments and merged pull request. Every reused child is read in full again within twelve passes.
- Private timing, request counts and reuse counts show where a refresh spends its budget. The refresh report has a `Reads:` line.

### Fixed

- Programme state documents are replaced only against the version they were read with. A read that comes back without its version id writes nothing.
