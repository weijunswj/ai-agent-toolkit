### Fixed

- Governance App setup now links an organisation-owned repository to its organisation's "New GitHub App" page, read from the repository's owner type. A personal App cannot be installed on an organisation's repository. When the owner type cannot be read, the steps show both pages.
- The cloud programme sweep, its gate, its merged-binding read and `toolkit permissions` now read a version 1 programme file as governance enabled, as the rest of Toolkit does. Such repositories were silently skipped.
- Every cloud sweep skip (no programme file, governance off, invalid or oversized file, another repository named, foreign evidence store, public state branch, App not set up) and the sweep gate's skip are now one visible warning that names the repository, the reason and the fix, instead of a quiet notice.
