# Bootstrap Mode

Use bootstrap mode when a repository does not yet have a documented process for reviewing and adopting third-party skill material.

## Goals

- Identify direct canonical skill and contract locations.
- Add a review record with source identity, license, attribution, and verdict.
- Add source locks for retained third-party material.
- Add deterministic routing, provenance, portability, and safety checks.
- Add local agent rules that separate review verdicts from mutation authority.

## Bootstrap Workflow

1. Inventory candidate docs, prompts, templates, examples, scripts, hooks, and metadata.
2. Classify each item as exact, adapted, excluded, or inspiration-only.
3. Record an `allow`, `reject`, or `constrain` verdict with evidence.
4. Confirm that implementation is separately authorized.
5. Place approved material directly in the target repository's canonical paths.
6. Add or update source locks, attribution, routing, and product metadata.
7. Add audits for broken provenance, stale identities, unsafe files, and lossy instructions.
8. Run focused validation and the target repository's completion gate.
9. Record reviewed baseline movement.

## Starter Local Docs

Use the repo-doc templates as starting points only:

- Source-of-truth doc.
- Direct canonical ownership standard.
- Surface fidelity audit.
- Deletion policy.
- Agent routing rules.

Replace placeholders with the target repo's actual paths, commands, and safety constraints.

## Bootstrap Guardrails

- Do not invent live-system automation while bootstrapping docs.
- Do not move product code into a reusable AI-surface repo.
- Do not turn summaries into the only copy of operational instructions.
- Do not delete old material until provenance and replacement coverage are clear.
- Do not create a secondary publisher, module, or mirrored ownership tree.
