# Source Manifest: A1-SOIR R1 Control-Plane Kernel

## Preserved in `_main/`

- `control-plane-contract.schema.json` - privacy-safe public result, remote-identity, and opaque authority-ticket contract.
- `control-plane-policy.json` - default-off typed-operation policy, resource bounds, hard-deny precedence, and active #342 compatibility rule.
- `fixtures/fixture-manifest.json` - exact 32-case adversarial contract inventory.

These files are first-party source authored for #346 A1-SOIR R1. No external or third-party source is copied or adapted.

## Runtime and focused validation

- `repo/scripts/toolkit-control-plane/control-plane-kernel.cjs` is the dependency-free deterministic runtime. It observes caller-owned values through one guarded detached-evidence traversal, then validates only detached data.
- `repo/tests/control-plane-kernel.test.cjs` is the RED-first and GREEN focused contract suite.
- `repo/tests/control-plane-kernel.boundaries.test.cjs` covers hostile dynamic, target-class, and compound masking boundaries.

The runtime has no network, filesystem, shell, child-process, provider, GitHub, hook, or host-configuration behavior. Ticket issuance and consumption require a module-private provenance-bound trusted authority context; no public self-mint or duck-typed store path exists. Ticket replay state is process-local and bounded; it is not durable, distributed, or native-host enforcement.

## Scope boundary

This module owns A1 only: repository/remote identity, typed operation validation, secret/finality boundaries, opaque authority tickets, bounded replay compaction, detached hostile-input observation, and structural-impact assessment. Repository capability lifecycle, execution-loop orchestration, independent assurance, Web finality, providers, and live systems remain outside scope.
