### Fixed

- New plain-text baselines store fingerprints instead of matched links. Legacy baselines remain recognised and can be migrated explicitly without increasing allowances; ordinary checks and installer refreshes leave them unchanged.
- Malformed or unreadable baselines fail with a generic message. Scoped checks cannot be combined with baseline writes, and the repository wrapper supports explicit migration.
