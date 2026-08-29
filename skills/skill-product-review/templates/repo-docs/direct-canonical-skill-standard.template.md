# Direct Canonical Skill Standard

Approved skill material has one maintained owner in the target repository. Adapt the example paths below to that repository. For this Toolkit, the product folder under `skills/**` and its supporting `repo/**` contracts are the canonical files.

## Ownership

- Edit canonical skill files directly.
- Do not create a second publisher tree, module owner, or mirrored copy as the source of truth.
- Keep routing, product metadata, documentation, and validation aligned with the canonical product ID.
- Use repository-declared generators only for bounded derived sections whose source path is explicit.

## Provenance

When third-party material remains active, keep a source lock that records upstream repository, ref, commit, lifecycle, update policy, attribution requirement, allowlisted files, and exact blob pins for copied or adapted files.

Classify retained material as exact, adapted, excluded, linked, or inspiration-only. Public attribution and manual review are required when the applicable license or repository policy requires them.

## Updates

1. Review the candidate and record an `allow`, `reject`, or `constrain` verdict.
2. Confirm mutation authority separately from the review verdict.
3. Update the direct canonical files and provenance records.
4. Align routing and product metadata.
5. Run focused checks, audits, and the repository's completion gate.
6. Inspect baseline movement before accepting it.
