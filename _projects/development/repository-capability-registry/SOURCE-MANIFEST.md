# Source Manifest: A2 Repository Capability Registry and Quiet Entry

## Preserved in _main/

- repository-capability-contract.schema.json - closed bounded external
  registry shape, privacy-safe receipt shape, and two-capability limit.
- repository-capability-policy.json - authority-relevant capability effects,
  transitions, quiet-entry invariants, and storage limits.

These are first-party source files authored for the accepted A2 Lock
DL-AGENT-NATIVE-LOOP-MVP-001-A2-CAPREG-QE-R1. No third-party source is copied
or adapted.

## Runtime and focused validation

- repo/scripts/toolkit-capability-registry.cjs reuses A1's exported
  validateRemoteIdentity() and remote contract version. It performs bounded
  local Git reads only, persists only an opaque repository digest, validates
  the closed registry before use, and provides an exclusive token-owned
  atomic writer.
- repo/tests/toolkit-capability-registry.test.cjs covers capability
  independence, explicit owner transitions, identity/reclone binding,
  privacy, and source/runtime contract alignment.
- repo/tests/toolkit-capability-registry.boundaries.test.cjs covers
  malformed/future/duplicate/oversized state, transaction and lock
  boundaries, CAS, and no-clobber behavior.
- repo/tests/toolkit-capability-registry.quiet-entry.test.cjs covers
  combined question fan-in, scoped setup/reopen, silent healthy entry, and
  zero-call instrumentation.

## Scope boundary

This module owns A2 repository capability state and host-light quiet entry
only. It does not grant A1 operation authority, widen a user task, invoke
models/network/providers/GitHub/hooks/bridge/renderer on healthy entry, or
implement A3, A4, N5, N6, N7, N8, #342, #348, deployment, credentials, or live
systems. codex_review remains an N5 owner preference and is not an A2
consent-controlled capability.
