# Enforcement Model

A safe skill-review and publication process needs both documentation and mechanical checks.

## Documentation Layer

Docs should explain:

- Direct canonical ownership.
- Review verdict and mutation-authority separation.
- Source identity, license, attribution, and source-lock rules.
- Routing and product metadata contracts.
- Validation commands.
- Validation strategy for targeted iteration and final full checks.
- Deletion policy.
- Live-system and credential boundaries.
- Baseline update policy.

## Evidence Layer

The review record should be specific enough for another maintainer to reproduce the decision.

Recommended fields:

- Product id and canonical paths.
- Upstream repository, ref, commit, and inspected paths.
- License and attribution status.
- Exact, adapted, excluded, and inspiration-only classifications.
- Prompt, executable, secret, and live-action findings.
- Verdict constraints and required approvals.

## Validation Layer

Deterministic checks should validate source locks, routing metadata, product IDs, portability, links, schema shape, and unsafe residue. They must not execute untrusted candidate code.

## Managed Marker Layer

Use managed markers when a script inserts, replaces, appends, extracts, or assembles a source-owned section inside a larger Markdown file:

```md
<!-- AI-AGENT-TOOLKIT:<source-path>:BEGIN <BLOCK-NAME> v1 -->
<!-- AI-AGENT-TOOLKIT:<source-path>:END <BLOCK-NAME> -->
```

`<source-path>` is the workspace-relative path to the canonical contract that supplies the managed text. `<BLOCK-NAME>` is a short uppercase label for the derived section. Update managed sections only through the target repository's declared generator. Keep the version stable for text-only changes; bump it when consumers must distinguish a contract change.

## Audit Layer

Audits should verify that provenance, attribution, routing, and canonical ownership stay honest. Start small, then add checks as the repository discovers failure modes.

## Validation Strategy Layer

Use targeted validation while editing and full repo validation before final reporting. See `validation-strategy.md` for the generic cadence, and follow local repo law when it is stricter or more specific.

## CI Layer

CI should run the canonical validation command as a read-only PR and default-branch gate:

- No live-system actions.
- No secret exposure to PR-controlled scripts.
- No execution of untrusted candidate code.
- Stable failures for broken source locks, routing, attribution, or forbidden residue.
- No automatic mutation of provenance or review decisions.

## Human Review Layer

Humans or authorized maintainers review candidate and adapted material. AI can draft, but the repository should make the evidence, verdict, and canonical owner explicit before publication.
