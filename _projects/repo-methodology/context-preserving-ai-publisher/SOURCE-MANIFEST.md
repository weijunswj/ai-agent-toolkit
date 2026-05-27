# Source Manifest: Context-Preserving AI Publisher

## Preserved In `_main/`

- `README.md`
- `agent-agnostic-principles.md`
- `context-drift-model.md`
- `source-to-surface-decision-tree.md`
- `bootstrap-mode.md`
- `maintenance-mode.md`
- `validation-strategy.md`
- `audit-and-baseline-workflow.md`
- `deletion-policy.md`
- `enforcement-model.md`
- `examples.md`
- `_partials/source-of-truth-contract.md`
- `templates/**`

The preserved files are first-party generic source authored for this module. They extract reusable publishing methods from this repo's architecture without copying this repo's local rules as universal law.
The source-of-truth contract partial is the repo-managed contract block source used by `repo/scripts/sync-repo-doc-contract.cjs`.

## AI-Facing Surfaces

- `skills/context-preserving-ai-publisher/SKILL.md` is a concise curated router.
- `skills/context-preserving-ai-publisher/README.md` is a curated install/use note.
- `skills/context-preserving-ai-publisher/references/README.md` is a curated skill-local reference index.
- `skills/context-preserving-ai-publisher/references/*.md` are exact generated copies from `_main/*.md`.
- `skills/context-preserving-ai-publisher/templates/**` are exact generated copies from `_main/templates/**`.

Curated source files in this module may contain output-relative links because they are authored as published-surface sources. Those links are intended to resolve after sync under `skills/context-preserving-ai-publisher/`.

## Link Shims

No compatibility shims are used in this module.

If future exact-copied runtime docs contain source-relative links that break after publishing, add tiny compatibility shims in `curated_output_for_ai/reference-link-shims/`, declare them in `toolkit.project.json`, and document the reason here. Shims are link adapters, not replacement docs.

## Excluded

- Credentials, `.env*`, private keys, credential exports, live imports/exports, package artifacts, and product repo files.
- MCP output. This PR publishes only the skill surface plus the existing generated project registry update.
- Root-level packs, playbooks, templates, registries, or tools.
