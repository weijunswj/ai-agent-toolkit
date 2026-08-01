# Source Manifest: Repo-Scoped Scheduled Auto-Code Protocol Design

## Ownership

This is first-party Toolkit source authored for the bounded design-only G3 lane of issue #329. The module is `source_only`: it publishes no `skills/**` entrypoint, no native plugin metadata, no MCP surface, and no consumer-facing generated output.

## Preserved source files

All runtime-critical design material is kept directly under `_main/`:

- `architecture.md`: scope, non-goals, future setup/cleanup, authority surfaces, adoption classes, review ownership, sensitive context, and completion boundary.
- `protocol.md`: packet grammar, staged publication, atomic claim interface, turn prerequisites, routing, hierarchy, redaction, and prompt safety.
- `state-machine.md`: controller/executor cycles, turn determination, parallel lanes, manual work, review sweep, and teardown invariants.
- `failure-matrix.md`: detection evidence, prohibited mutation, state transition, exact repair, and unrelated-lane handling for every required failure class.
- `templates/AGENTS.auto-code.managed.md`: compact source-owned consumer block; it is not installed by this PR.
- `templates/web-controller-scheduled-task.prompt.md`: future fresh-chat L0/controller prompt and editable routing profiles.
- `templates/executor-scheduled-task.prompt.md`: future fresh-chat L0/executor prompt and editable routing profiles.
- `templates/child-cycle-comment.md`: canonical child audit/handoff comment template.
- `templates/pr-handoff-pointer.md`: compact PR discoverability pointer template.
- `fixtures/*.json`: design-state fixtures consumed by `repo/tests/repo-auto-code-design.test.cjs`.

## Output and write boundary

There are no declared generated outputs. The project manifest therefore declares `outputs: []` and `writes.allowed: []`. Source edits in this module and the one authorised test are the only files in the G3 assignment; no manifest entry grants writes to root instructions, skills, workflows, schedulers, claim refs, GitHub state, or plugin metadata.

## Routing decision

- Agent-usable skill: no.
- Skill entrypoint: none.
- Toolkit skill routing update: intentionally omitted because this PR designs a future capability without installing it.
- MCP output: none; repo-wide MCP is not shipped by this repository.
- Generated output: none.

## Validation contract

The focused test discovers every fixture file, validates exact packet and managed-block grammar, exercises each fixture ID, rejects unsafe or partial state, checks manifest non-activation, and verifies no generated surface is declared. The sync check and source-lock audit prove that the module remains source-owned and schema-conformant.

## Third-party material

None. No third-party skill, prompt, workflow, source path, package, credential, or runtime mechanism is copied, imported, installed, or executed.
