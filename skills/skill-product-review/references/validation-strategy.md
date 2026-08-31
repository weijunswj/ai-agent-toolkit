# Validation Strategy

Use targeted validation while reviewing or adapting source-traceable skill material, then run the target repository's documented completion gate.

## During Review

Use narrow checks to localize failures:

- schema or JSON parsing after metadata changes;
- source-lock and attribution audits after provenance changes;
- routing tests after product identity or trigger changes;
- portability and link checks after moving skill files;
- focused tests for each changed validator or policy;
- whitespace and residue checks before staging.

Never execute untrusted candidate code merely to validate a review.

## Before Completion

Run broader local validation when the target repository requires it, when the change is broad or safety-sensitive, or when focused checks do not cover the final diff. If CI owns a full gate, follow local law instead of duplicating it by default.

If validation fails, reproduce the smallest failing contract, repair it, and rerun the affected checks. Do not update baselines or weaken assertions solely to make a failure disappear.

## Publication Integrity

Validate the final files in their direct canonical locations. Source locks, attribution, routing metadata, and any repository-declared generated sections must agree with those files. Keep CI read-only unless the target repository separately documents and authorizes a narrow mutation path.

## Local Law Wins

The target repository's agent instructions, source-of-truth contract, validation commands, and maintainer request override this generic cadence.
