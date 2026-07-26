# Repository Security Gate

This generated skill folder is the portable consumer unit for Toolkit's
repository-owned security gate.

- `tools/`: protected-authority wrapper, local runner, protected suppression
  invariant harness, and verified pinned-tool installer.
- `config/`: policy, ordinary invariants, protected active suppressions,
  protected closure manifest, and provenance lock.
- `rules/`: Toolkit-owned rules only.
- `schemas/`: lock, report, active-suppression, candidate-proposal, invariant,
  and review-packet contracts.
- `fixtures/`: synthetic clean and malicious cases.
- `templates/github/`: thin repo-local CI and quarantined candidate templates.
- `references/`: architecture and official-source tool adjudication.

Consumers must pin module version `1.2.1` and commit a repo-local copy. They
must not depend only on a mutable Toolkit branch or cross-organisation reusable
workflow.

A passing CI verdict requires the protected workflow to execute the wrapper
from an exact trusted commit while the candidate checkout is scanned only as
data. Direct execution from a candidate checkout is diagnostic and cannot
self-certify PASS. Candidate suppression proposals never affect the current
verdict; active authority and compensating executable closure come only from
the exact trusted checkout.
