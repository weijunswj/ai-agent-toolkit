# Source Manifest: Repo Loop Core

## Preserved in `_main/`

- `authority-contract.schema.json` - versioned local/remote authority snapshot contract.
- `terminal-packet.schema.json` - self-describing terminal evidence contract.
- `state-machine.md` - bounded A1 state and refusal boundary.

These are first-party source contracts for the A1 implementation in `repo/scripts/repo-loop-core/repo-loop-core.cjs`. No Web controller runtime, model, provider, or reasoning policy is represented or inferred.

## Runtime and focused test source

- `repo/scripts/repo-loop-core/repo-loop-core.cjs` - pure, side-effect-free contract and digest implementation.
- `repo/tests/repo-loop-core-contract.test.cjs` - RED-first contract, opacity, path, evidence, and default-off tests.
- `repo/tests/validate-toolkit.test.cjs` - exact project-manifest allowlist consumer, updated only for this project identity.

## Source-to-surface receipt

`toolkit.project.json` declares `surface.publish_as: source_only` with an empty output list. Sync validates the project shape without generating skills, MCP, instruction, plugin, or other published output. The audit baseline records the project while published-file totals remain unchanged.

## A1 boundary

This source owns authority evidence, role-local non-Web assignment evidence, trusted current-operation-time evidence, canonical Git paths, deterministic packet identity, immutable terminal packets, and typed default-off refusal. It does not launch, activate, consent, mutate, merge, deploy, or contact providers. Unknown authority ownership/liveness blocks without stale-lock deletion or recovery.

## Deferred

Durable leases, convergence reducers, blocker-root reduction, cumulative finding classification, aggregate non-convergence telemetry, policy calculation, and provider/review integration are reserved for later slices and are not implemented here.
