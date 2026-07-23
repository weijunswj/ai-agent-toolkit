# Repository Security Gate

This generated skill folder is the portable consumer unit for Toolkit's
repository-owned security gate.

- `tools/`: local runner and verified pinned-tool installer.
- `config/`: policy, invariants, and provenance lock.
- `rules/`: Toolkit-owned rules only.
- `schemas/`: lock, report, suppression, and review-packet contracts.
- `fixtures/`: synthetic clean and malicious cases.
- `templates/github/`: thin repo-local CI and quarantined candidate templates.
- `references/`: architecture and official-source tool adjudication.

Consumers must pin module version `1.0.0` and commit a repo-local copy. They
must not depend only on a mutable Toolkit branch or cross-organisation reusable
workflow.
