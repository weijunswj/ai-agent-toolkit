# Source Manifest: Repo-Scoped Default-Off Closure-Lease Auto-code

## Ownership

This is first-party Toolkit source for the bounded G3 implementation/amendment lane of issue #329. The module is source_only and publishes no skill entrypoint, native plugin metadata, MCP surface, installed instruction, or consumer-facing generated output.

## Preserved source files

Runtime-critical design material is kept directly under _main/:

- architecture.md: roles, capabilities, authority, isolation, mutation scope, review, assurance, and finality.
- protocol.md: prompt fields, admission, exact activation, claims, reconciliation, mutation, G4, assurance, and evidence contracts.
- state-machine.md: default-off lifecycle and guarded transitions.
- failure-matrix.md: evidence, prohibited mutation, exact return code, and repair boundary.
- templates/AGENTS.auto-code.managed.md: inert source-only managed contract; it is not installed by this PR.
- templates/closure-manager.prompt.md: generic closure-manager prompt contract.
- templates/implementation-worker.prompt.md: generic implementation/amendment prompt contract.
- templates/final-pre-g4-reviewer.prompt.md: generic pre-G4 prompt contract.
- templates/authoritative-g4-reviewer.prompt.md: generic authoritative G4 prompt contract.
- templates/independent-assurance-audit.prompt.md: generic assurance prompt contract.
- templates/evaluation-candidate.comment.md: public-safe evaluation-staging payload contract.
- fixtures/*.json: raw-evidence fixtures consumed by repo/tests/repo-auto-code-design.test.cjs.

## Output and write boundary

The manifest declares outputs as an empty array and writes.allowed as an empty array. Scheduled-task, activation, claim, queue, runtime, installation, and arbitrary-output writes are denied. No generated or installed surface is created.

## Routing decision

- Agent-usable skill: no.
- Skill entrypoint: none.
- Toolkit skill routing update: intentionally omitted because this PR remains uninstalled.
- MCP output: none.
- Generated output: none.

## Fixture inventory

Filesystem discovery is authoritative. The final universe is 112 fixtures: 17 accepted and 95 rejected. The arithmetic is 85 existing, minus 25 explicit deletions, plus 52 explicit additions. Every rejected fixture carries accepted:false and mutationProhibited:true, either as the current raw fixture fields or as the preserved legacy expected classification.

The runner reconciles retained, deleted, and added names against the merge parent and rejects unexpected extras, duplicate IDs, missing additions, and undeleted retired files.

## Validation contract

The focused test parses raw evidence, derives lifecycle, route, reconciliation, claim, G4, assurance, evaluation, and cleanup decisions, and verifies that fixture projections or fallback defaults cannot self-certify readiness or completion. Sync, source-lock, surface, and repository audits prove that this module remains source-owned.

## Provenance

No third-party material, package, credential, workflow, runtime state, or external service is copied, imported, installed, or executed.
