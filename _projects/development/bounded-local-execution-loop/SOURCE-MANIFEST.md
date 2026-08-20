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
  reads A2 status, admits root-only or fully verified delegated routes, keeps
  delegated substantive start at admitted until an exact live-ref-verified
  workspace receipt with explicit observed commit/tree and synchronous positive
  snapshot verification advances the run to workspace-ready, uses inert
  reservations plus one atomic delegated batch commitment, uses an injected
  A1 broker, requires exact run/workspace evidence, a mandatory live-ref
  provider, and an exact owned mutation lease before typed git.commit staging
  and commit, persists the existing five-contract durable run/workspace/terminal
  evidence only through governed predecessor-bound progression, derives lease
  release only from exact cross-validated durable state, and rejects
  out-of-scope staged/unstaged/untracked worktree changes including hook
  broadening, and re-reads A2 consent before workspace-ready to running and
  immediately before the atomic substantive batch. No release-grade durable
  writer is exported; caller-authored contract-shaped artifacts cannot create
  release authority.
- repo/tests/toolkit-execution-loop.test.cjs covers the green contract,
  routing, workspace-bound lifecycle, atomic delegated start, A1 broker,
  typed commit, persistence, and finality paths.
- repo/tests/toolkit-execution-loop.boundaries.test.cjs covers malformed,
  future, privacy, concurrency, durable-release, worktree, recovery, and
  cleanup boundaries.
- repo/tests/toolkit-execution-loop.run163-red.test.cjs covers governed
  completion, safe release, and fresh-run lease recovery.
- repo/tests/toolkit-execution-loop.run164-red.test.cjs covers removal of the
  sixth durable structure, internalized write APIs, monotonic predecessors,
  standalone artifact rejection, and genuine governed release.

## Scope boundary

This module owns A3 bounded local execution-loop contracts and runtime only.
It does not add skills, MCP, plugins, native adapters, providers, live
integrations, N5/N7/N8 work, full #242 machinery, A4, #342 propagation,
review mutation, merge, Ready, or Web finality.
