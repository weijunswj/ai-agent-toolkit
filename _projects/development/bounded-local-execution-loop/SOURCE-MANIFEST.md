# Source Manifest: A3 Bounded Local Execution-Loop

## Preserved in _main/

- execution-loop-contract.schema.json - the five closed, bounded, canonical
  request, route-plan, run-receipt, workspace-receipt, and terminal-packet
  contracts.
- execution-loop-policy.json - A2 consent, route admission, live-ref,
  lifecycle, A1 broker, typed commit, persistence, cleanup, and finality
  boundaries.

These are first-party source files authored for RUN-157 from the accepted
canonical A1/A2 main. No third-party source is copied or adapted.

## Runtime and focused validation

- repo/scripts/toolkit-execution-loop.cjs is a dependency-free runtime. It
  reads A2 status, admits root-only or fully verified delegated routes, binds
  fresh live-ref workspaces, uses an injected A1 broker, executes only the
  typed stage-plus-commit seam, and keeps bounded external state.
- repo/tests/toolkit-execution-loop.test.cjs covers the green contract,
  routing, lifecycle, A1 broker, typed commit, persistence, and finality
  paths.
- repo/tests/toolkit-execution-loop.boundaries.test.cjs covers malformed,
  future, privacy, concurrency, recovery, and cleanup boundaries.

## Scope boundary

This module owns A3 bounded local execution-loop contracts and runtime only.
It does not add skills, MCP, plugins, native adapters, providers, live
integrations, N5/N7/N8 work, full #242 machinery, A4, #342 propagation,
review mutation, merge, Ready, or Web finality.
