# Source Manifest: A1 Control-Plane Kernel

## Preserved in `_main/`

- `control-plane-contract.schema.json` — the public runtime result, remote-identity, and authority-ticket schema.
- `control-plane-policy.json` — the default-off typed-operation policy and temporary #342 compatibility status.
- `fixtures/fixture-manifest.json` — the required adversarial contract-case inventory.

These files are first-party source authored for #346 A1. No external or third-party source is copied or adapted.

## Runtime and focused validation

- `repo/scripts/toolkit-control-plane/control-plane-kernel.cjs` is the dependency-free deterministic runtime. Authority tickets require identity-bearing authority evidence and bind issuer role/identity/evidence digest plus session, turn, call, operation, target, and scope at atomic consumption.
- `repo/tests/control-plane-kernel.test.cjs` is the RED-first and GREEN focused contract suite.

The runtime has no network, filesystem, shell, child-process, provider, GitHub, hook, or host-configuration behavior. Ticket replay state is process-local and bounded; it is not durable, distributed, or native-host enforcement.

## Scope boundary

This module owns A1 only: identity, typed operation authority, secret/finality boundaries, one-shot authority tickets, bounded replay compaction, and structural-impact assessment. Repository capability lifecycle, loop execution, independent assurance, Web finality, consumers, providers, and live systems remain outside scope.
