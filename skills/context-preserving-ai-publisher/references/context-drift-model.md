<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/context-drift-model.md
Update the project source and run sync.
-->
# Context Drift Model

Context drift happens when an AI-facing surface no longer carries the source context needed to use it safely and correctly.

## Common Drift Modes

### Source Erosion

A full guide is replaced by a short summary. Future agents lose setup steps, safety gates, edge cases, examples, or troubleshooting details.

Prevent it by preserving full source and publishing exact copies, extracts, or concatenations for runtime-critical material.

### Adapter Overreach

A curated router or wrapper grows into an unofficial copy of the source. It becomes easier to edit the adapter than the source, and the two drift apart.

Prevent it by keeping adapters short and making them point to the source-backed references.

### Orphan Output

A published file exists under a skill, MCP surface, or template folder but is not declared by any manifest. Nobody knows which source owns it.

Prevent it by requiring every published output to be declared or explicitly classified as linked.

### Cross-Owned Output

One project writes into another project's surface without declaring the ownership split.

Prevent it by declaring shared-surface outputs only when there is a real provenance reason and documenting the owning project.

### Baseline Drift

An audit baseline changes but nobody records why. Later agents cannot tell whether the movement was intentional or a regression.

Prevent it by reviewing audit deltas before updating baselines and by recording exact count movement in the PR.

### Broken Provenance

Source locks, manifests, or attributions stop matching the files they describe.

Prevent it with source-lock audits and clear notes for exact, adapted, excluded, and linked material.

### Unsafe Deletion

An agent removes a source file, generated surface, shim, or template because it appears duplicate.

Prevent it by requiring ownership checks, manifest checks, and regeneration checks before deletion.

### Link Relocation Drift

Exact-copied docs keep source-relative links that break after publishing into a skill folder.

Prevent it by using small compatibility shims when rewriting the full copied document would create unnecessary drift.
