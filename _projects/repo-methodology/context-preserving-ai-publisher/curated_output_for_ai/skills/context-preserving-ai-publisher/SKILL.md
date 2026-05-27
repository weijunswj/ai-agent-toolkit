---
name: context-preserving-ai-publisher
description: Use when creating or maintaining source-traceable AI-facing repo surfaces, generated skills, MCP notes, templates, pack metadata, manifests, source locks, audit baselines, or anti-drift documentation.
---

<!--
Curated AI-facing source.
Project: repo-methodology.context-preserving-ai-publisher
Review rule: Keep this skill agent-agnostic. Do not copy this toolkit repo's local law into the generic workflow.

Published-surface source note: This file is authored as a published-surface source; relative links are intended to resolve after sync at skills/context-preserving-ai-publisher/SKILL.md.
-->

# Context-Preserving AI Publisher

Use this skill to create or maintain AI-facing repo surfaces without losing source context, provenance, safety rules, or generated-output ownership.

## First Decision

- Bootstrap mode: the repo does not yet have source layers, manifests, generated-surface checks, or local agent rules. Read `references/bootstrap-mode.md`.
- Maintenance mode: the repo already has local docs, manifests, generated outputs, audits, or validation. Read the local repo docs first, then read `references/maintenance-mode.md`.

When local repo law conflicts with this generic skill, local law wins.

## Core Workflow

1. Identify the requested published surface and the owning repo/module.
2. Read local source-of-truth docs, agent instructions, manifests, and validation docs.
3. Classify the material as source, reviewed adapter, generated output, linked exception, excluded, or obsolete.
4. Use `references/source-to-surface-decision-tree.md` to choose source location and recipe.
5. Edit the source of truth, not generated outputs, unless the local manifest explicitly marks an output as linked.
6. Run the repo's deterministic sync/check commands.
7. Run the smallest relevant audits and tests; use `references/validation-strategy.md` for validation cadence.
8. Update audit baselines only after reviewing exact count movement.
9. Report changed files, copied source outputs, curated adapters, baseline movement, validation, and remaining risks.

## Source Model

- Source layer: full original material and provenance.
- Reviewed adapter layer: short routers, indexes, wrappers, metadata, manifests, and shims.
- Manifest/routing contract: declared mapping from source to published output.
- Portable generated surfaces: skills, MCP docs, templates, packs, references, or equivalent repo-local surfaces.
- Local law/docs: repo-specific rules, commands, validation, and safety policy.
- Deterministic publishing: copy, extract, concat, JSON formatting, or registry generation without AI summarisation.
- Audits: checks for undeclared outputs, lossy surfaces, ownership confusion, unsafe deletions, and baseline drift.

## References

- `references/agent-agnostic-principles.md`: general principles.
- `references/context-drift-model.md`: drift modes and prevention.
- `references/source-to-surface-decision-tree.md`: recipe and ownership choices.
- `references/bootstrap-mode.md`: starting architecture in a new repo.
- `references/maintenance-mode.md`: working inside an existing local contract.
- `references/validation-strategy.md`: targeted local checks plus CI or documented full-gate validation.
- `references/audit-and-baseline-workflow.md`: audit and baseline handling.
- `references/deletion-policy.md`: deletion and retirement checks.
- `references/enforcement-model.md`: docs, manifests, sync, audit, and CI.
- `references/examples.md`: generic concepts mapped to this repo as one implementation.

## Templates

- `templates/agent-task-brief.template.md`
- `templates/audit-triage.template.md`
- `templates/source-to-surface-decision.template.md`
- `templates/pr-summary.template.md`
- `templates/repo-docs/`
- `templates/project-module/`
- `templates/ci/`

## Rules

- Do not overwrite existing local repo law with generic templates.
- Do not make generated outputs the source of truth.
- Do not summarise full runtime docs into thin published surfaces.
- Do not edit generated files directly when a manifest declares their source.
- Do not add root-level surface folders if the target repo has a different topology.
- Do not add live-system, credential, deployment, or destructive automation without explicit local approval.
- Do not update an audit baseline until the movement is inspected and intentional.

## Output

Report:

- Mode used: bootstrap or maintenance.
- Source files changed.
- Published/generated files changed.
- Exact-copy outputs versus curated routers/indexes.
- Manifest and baseline movement.
- Validation commands and results.
- Remaining risks or manual checks.
