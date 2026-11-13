### Fixed

- Governance App setup now links an organisation-owned repository to its organisation's "New GitHub App" page, read from the repository's owner type. A personal App cannot be installed on an organisation's repository. When the owner type cannot be read, the steps show both pages.
- The cloud programme sweep, its gate, its merged-binding read and `toolkit permissions` now read a version 1 programme file as governance enabled, as the rest of Toolkit does. Such repositories were silently skipped.
