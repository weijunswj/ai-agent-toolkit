# Repository Security Gate

This generated skill folder is the portable consumer unit for Toolkit's
repository-owned security gate.

- `tools/`: protected-authority wrapper, local runner, required-check producer
  and terminal verifier, protected suppression invariant harness, and verified
  pinned-tool installer.
- `config/`: policy, ordinary invariants, protected active suppressions,
  protected closure manifest, and provenance lock.
- `rules/`: Toolkit-owned rules only.
- `schemas/`: lock, report, active-suppression, candidate-proposal, invariant,
  and review-packet contracts.
- `fixtures/`: synthetic clean and malicious cases.
- `templates/github/`: thin repo-local CI and quarantined candidate templates.
- `references/`: architecture and official-source tool adjudication.

Consumers must pin module version `1.3.0` and commit a repo-local copy. They
must not depend only on a mutable Toolkit branch or cross-organisation reusable
workflow.

A passing required-check verdict requires a separately deployed first-party
GitHub App to dispatch the protected default-branch workflow and verify the
sealed terminal receipt while the candidate checkout is scanned only as data.
The App source is intentionally not shipped in this portable skill and no App
is deployed by installation. Direct candidate execution is diagnostic and
cannot self-certify PASS. Candidate suppression proposals never affect the
current verdict; active authority and compensating executable closure come
only from the exact trusted checkout.
