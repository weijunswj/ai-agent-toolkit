# Deletion Policy

Deletion must preserve source ownership and generated-surface integrity.

## Before Deleting

Check:

- Canonical product owner.
- Canonical file path.
- Routing and metadata references.
- Review or migration record.
- Source lock or provenance entry.
- Registry or index references.
- Audit baseline entries.

## Required Steps

1. Remove references.
2. Update routing and metadata.
3. Update provenance metadata.
4. Run focused ownership and provenance checks.
5. Run audits.
6. Document baseline movement.

## Forbidden Shortcuts

- Do not delete complete instructions because a shorter summary exists.
- Do not delete repository-declared derived sections without updating their canonical source and generator contract.
- Do not delete safety rules to make validation pass.
- Do not delete baselines without explaining the audit movement.
