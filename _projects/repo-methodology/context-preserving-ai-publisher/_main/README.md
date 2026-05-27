# Context-Preserving AI Publisher

This source package teaches a portable method for publishing AI-facing repo surfaces without losing the context, ownership, and safety rules that make the source trustworthy.

The method is agent-agnostic. It can be used by ChatGPT, Claude, Codex, Gemini, Cursor, Windsurf, Roo/Cline, OpenCode, or another agent that can inspect a repository and edit files.

## Core Model

- Source layer: full original material, preserved with provenance.
- Reviewed adapter layer: short routers, indexes, wrappers, manifests, metadata, and compatibility shims.
- Manifest/routing contract: exact declarations of which source publishes to which output.
- Portable generated surfaces: copyable skills, MCP docs, templates, packs, references, or equivalent local repo surfaces.
- Local law/docs: repo-specific rules, validation policy, commands, and audit expectations.
- Validation strategy: targeted local checks plus the target repo's CI or documented full gate.
- Deterministic publishing: scripts copy, extract, concatenate, or generate outputs without AI summarisation.
- Audits: checks for undeclared outputs, lossy surfaces, ownership confusion, broken provenance, unsafe deletion, and stale baselines.

## Modes

Use bootstrap mode when a repo does not yet have a source-to-surface architecture.

Use maintenance mode when a repo already has local docs, manifests, generated outputs, or validation. In maintenance mode, the local repo law wins over these generic templates.

For validation cadence, see [validation-strategy.md](validation-strategy.md).
