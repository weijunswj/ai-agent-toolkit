<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/templates/repo-docs/source-of-truth.template.md
Update the project source and run sync.
-->
# Source Of Truth

This repo owns reusable AI-facing source material and generated surfaces.

## Layers

- Source layer: full source docs, prompts, templates, specs, examples, and provenance.
- Reviewed adapter layer: short routers, indexes, wrappers, metadata, and compatibility shims.
- Published surfaces: generated skills, MCP notes, references, templates, packs, or equivalent repo-local outputs.
- Local law: repo-specific rules, validation, deletion policy, and safety constraints.

## Rules

- Full working instructions stay in the source layer.
- Generated outputs are not edited directly unless marked as linked.
- Curated adapters must not replace source docs with lossy summaries.
- Every published output must be declared by a manifest or linked exception.
- Deterministic sync must not use AI summarisation.
- Credentials, private files, live exports, and product-owned files stay out of reusable surfaces.

## Validation

Use this repo's documented commands:

```sh
<sync check command>
<audit command>
<test command>
```
