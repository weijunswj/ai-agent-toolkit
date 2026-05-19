# Bootstrap Mode

Use bootstrap mode when a repo does not yet have a source-to-surface publishing architecture.

## Goals

- Create a source layer for full material.
- Create a reviewed adapter layer for AI-facing routers and indexes.
- Add a manifest that declares source-to-output publishing.
- Add deterministic sync and check commands.
- Add starter audits for drift, ownership, and deletion safety.
- Add local agent-routing rules that tell agents how to use the repo's source of truth.

## Bootstrap Workflow

1. Inventory existing docs, prompts, templates, specs, examples, and generated AI-facing files.
2. Classify each file as source, adapter, generated output, linked exception, obsolete, or excluded.
3. Move or preserve full working material in the source layer.
4. Create short adapter files only where they help agents find the full material.
5. Write a manifest that maps source files to output files.
6. Create deterministic sync and check commands.
7. Add audits for undeclared outputs, broken provenance, lossy summaries, and stale generated files.
8. Generate outputs.
9. Run validation.
10. Record audit baseline movement in the first PR.

## Starter Local Docs

Use the repo-doc templates as starting points only:

- Source-of-truth doc.
- Project/module standard.
- Surface fidelity audit.
- Deletion policy.
- Agent routing rules.

Replace placeholders with the target repo's actual paths, commands, and safety constraints.

## Bootstrap Guardrails

- Do not invent live-system automation while bootstrapping docs.
- Do not move product code into a reusable AI-surface repo.
- Do not turn summaries into the only copy of operational instructions.
- Do not delete old material until provenance and replacement coverage are clear.
- Do not make generated outputs the source of truth.
