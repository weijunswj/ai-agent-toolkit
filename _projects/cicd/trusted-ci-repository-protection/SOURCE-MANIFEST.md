# Source Manifest: N6 Trusted CI Repository Protection

## Preserved In `_main/`

- `trusted-ci-repository-protection-contract.schema.json` - closed N6
  evidence, publisher, gate, composition, and protection contract shape.
- `trusted-ci-repository-protection-policy.json` - modes, state transitions,
  ownership, least-privilege, consent, and live-action boundaries.
- `app-publisher-protocol.json` - narrow Check Run publisher contract.
- `protected-ci-gate-workflow-contract.json` - protected base-owned workflow
  identity and trigger contract.
- `templates/protected-ci-gate.workflow.yml` - inactive credential-free
  protected workflow template.
- `fixtures/**` - non-live deterministic contract fixtures.

## Runtime and Focused Validation

- `repo/scripts/toolkit-trusted-ci-repository-protection.cjs` is the
  dependency-free pure runtime for evidence, composition, state, publisher,
  projection, ownership, and preview planning.
- `repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs` validates
  the protected workflow source and invokes the pure composition/evidence
  validators without executing candidate code or making network calls.
- Focused tests live under `repo/tests/` and cover adversarial identity,
  evidence, archive, publisher, workflow, ownership, consent, and compatibility
  boundaries.

## Scope Boundary

This module owns the N6 trusted-CI contract and local preview logic only. It
does not install or authenticate a GitHub App, publish Check Runs, write commit
statuses, mutate rulesets, activate required checks, perform provider/UAT
validation, deploy, merge, mark Ready, or provide Web finality.

This source is first-party and does not copy or adapt third-party workflow,
provider, credential, or hosted evidence material.
