<!--
Generated from toolkit project source. Do not edit directly.
Project: meta.context-preserving-ai-publisher
Source: _projects/meta/context-preserving-ai-publisher/_main/enforcement-model.md
Update the project source and run sync.
-->
# Enforcement Model

A context-preserving publisher needs both documentation and mechanical checks.

## Documentation Layer

Docs should explain:

- Source layer purpose.
- Adapter layer purpose.
- Published surface purpose.
- Manifest contract.
- Validation commands.
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

## Audit Layer

Audits should verify that the manifest and generated surfaces stay honest. Start small, then add checks as the repo discovers failure modes.

## CI Layer

CI should run read-only checks for normal PRs. If the repo supports generated-output writeback, keep it narrow:

- Same-repo PR branches only.
- Never on the default branch.
- Deterministic sync only.
- No live-system actions.
- No secret exposure to PR-controlled scripts.
- Diff checks before committing generated output.

## Human Review Layer

Humans or maintainers review source and curated adapter material. AI can draft, but the repo should make reviewed source explicit before publishing.
