# Audit And Baseline Workflow

Audits make provenance, ownership, and safety drift visible. Baselines make reviewed findings explicit while follow-up cleanup is still in progress.

## Audit Targets

Use audits to detect:

- Canonical skill files without a current owner or routing record.
- Copied or adapted third-party files without source locks or attribution.
- Lossy replacements for runtime-critical instructions.
- Broken relative links inside portable skill folders.
- Stale public IDs, aliases, compatibility routes, or duplicate owners.
- Suspicious package artifacts, credentials, live exports, or private files.

## Running Audits

Prefer the target repository's documented commands. If no commands exist, add the smallest deterministic read-only check that proves the affected contract.

Use `validation-strategy.md` for validation cadence: targeted checks during iteration, plus the target repository's CI or documented completion gate.

A good audit command should:

- Read local files only.
- Avoid network and live-system actions.
- Avoid executing candidate or PR-controlled third-party code.
- Print stable findings.
- Exit nonzero when new unreviewed findings appear.

## Updating Baselines

Update a baseline only when all of these are true:

- The relevant audit was run against the final direct-canonical files.
- New findings or count movement were inspected.
- The movement is caused by the current intentional change.
- No undeclared, cross-owned, suspicious, or boundary findings were introduced.
- The change summary records the exact movement.

Do not use privileged automation to bless provenance changes. Update canonical files, source locks, attribution, and reviewed baselines in the authorized change, then rely on read-only validation.

## Reporting

Report changed canonical files, baseline movement, unchanged findings, exact validation results, and any historical identifiers retained only for migration evidence.
