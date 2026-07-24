<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: cicd.repository-security-gate
Source: _projects/cicd/repository-security-gate/curated_output_for_ai/skills/repository-security-gate/README.md
Update the curated output and run sync.
-->
# Repository Security Gate

This generated skill folder is the portable consumer unit for Toolkit's
repository-owned security gate.

- `tools/`: protected-authority wrapper, local runner, and verified pinned-tool
  installer.
- `config/`: policy, invariants, and provenance lock.
- `rules/`: Toolkit-owned rules only.
- `schemas/`: lock, report, suppression, and review-packet contracts.
- `fixtures/`: synthetic clean and malicious cases.
- `templates/github/`: thin repo-local CI and quarantined candidate templates.
- `references/`: architecture and official-source tool adjudication.

Consumers must pin module version `1.2.0` and commit a repo-local copy. They
must not depend only on a mutable Toolkit branch or cross-organisation reusable
workflow.

A passing CI verdict requires the protected workflow to execute the wrapper
from an exact trusted commit while the candidate checkout is scanned only as
data. Direct execution from a candidate checkout is diagnostic and cannot
self-certify PASS.
