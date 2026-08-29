# Agent Routing

AI agents working in this repo should use local source-of-truth docs before generic guidance.

## Routing Rules

- For source-to-surface changes, inspect the owning project/module manifest first.
- For generated outputs, edit source or curated adapter files and rerun sync.
- For linked outputs, read the linked-output reason before editing.
- For skill changes, keep skill-routing guidance aligned with current `skills/*/SKILL.md`, registry metadata, platform setup docs, and README skill tables when applicable.
- For deletion, follow the deletion policy.
- For audit baseline changes, inspect count movement before updating.

## Safety

- Do not add credentials, private keys, live exports, local-only runtime output, or product-owned files.
- Do not mutate live systems unless explicitly confirmed by the user and allowed by local policy.
- Do not replace full source docs with summaries.

## Validation

Use the repo's documented validation commands and report results.
