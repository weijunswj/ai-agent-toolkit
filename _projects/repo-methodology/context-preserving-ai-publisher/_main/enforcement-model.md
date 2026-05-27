# Enforcement Model

A context-preserving publisher needs both documentation and mechanical checks.

## Documentation Layer

Docs should explain:

- Source layer purpose.
- Adapter layer purpose.
- Published surface purpose.
- Manifest contract.
- Validation commands.
- Validation strategy for targeted iteration and final full checks.
- Deletion policy.
- Live-system and credential boundaries.
- Baseline update policy.

## Manifest Layer

The manifest is the routing contract. It should be specific enough that a deterministic script can generate or check every output.

Recommended fields:

- Project id and title.
- Source root.
- Output recipes.
- Allowed writes.
- Denied sensitive paths.
- Fidelity classification.
- Shared-surface metadata.
- Approval and live-action policy.

## Sync Layer

The sync script should be deterministic and boring:

- Copy exact files.
- Extract exact sections.
- Concatenate declared inputs.
- Format JSON.
- Generate simple registries.
- Refuse undeclared writes.

It should not use AI to summarise or rewrite source during normal publishing.

## Managed Marker Layer

Use managed markers when a script inserts, replaces, appends, extracts, or assembles a source-owned section inside a larger Markdown file:

```md
<!-- AI-AGENT-TOOLKIT:<source-path>:BEGIN <BLOCK-NAME> v1 -->
<!-- AI-AGENT-TOOLKIT:<source-path>:END <BLOCK-NAME> -->
```

`<source-path>` is the workspace-relative path to the source partial, contract, adapter, or generator-owned section that supplies the managed text. `<BLOCK-NAME>` is a short uppercase label for the generated section, such as `GLOBAL-AGENTS.MD-TEMPLATE`, `N8N-AGENT-RULES-ADAPTER`, or `SOURCE-OF-TRUTH-CONTRACT`. Update managed sections from the mapped source file or generator, then rerun sync. Keep the version stable for text-only changes; bump it when the managed section contract changes in a way scripts or consumers must distinguish.

## Audit Layer

Audits should verify that the manifest and generated surfaces stay honest. Start small, then add checks as the repo discovers failure modes.

## Validation Strategy Layer

Use targeted validation while editing and full repo validation before final reporting. See `validation-strategy.md` for the generic cadence, and follow local repo law when it is stricter or more specific.

For this toolkit repo, `npm run validate:all` is the canonical full validation command and required merge gate.

## CI Layer

CI should run the canonical full validation command as the read-only PR and default-branch gate. If the repo supports generated-output writeback, keep it narrow and optional:

- Same-repo PR branches only.
- Never on the default branch.
- Deterministic sync only.
- No live-system actions.
- No secret exposure to PR-controlled scripts.
- Diff checks before committing generated output.
- Skip source/provenance `_main` PRs instead of treating auto-sync as a merge gate.

## Human Review Layer

Humans or maintainers review source and curated adapter material. AI can draft, but the repo should make reviewed source explicit before publishing.
