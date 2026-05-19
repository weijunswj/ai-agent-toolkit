# Deletion Policy

Deletion must preserve source ownership and generated-surface integrity.

## Before Deleting

Check:

- Owner project/module.
- Source layer file.
- Curated adapter file.
- Manifest recipe.
- Generated output path.
- Source lock or provenance entry.
- Registry, pack, or index references.
- Audit baseline entries.

## Required Steps

1. Remove references.
2. Update the manifest.
3. Update provenance metadata.
4. Run sync.
5. Run generated freshness checks.
6. Run audits.
7. Document baseline movement.

## Forbidden Shortcuts

- Do not delete source because a generated copy exists.
- Do not delete generated outputs manually when sync owns them.
- Do not delete safety rules to make validation pass.
- Do not delete baselines without explaining the audit movement.
