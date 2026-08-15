# Repo Loop Core

`repo-loop-core` is a first-party, source-only A1 contract foundation for bounded repository-loop evidence. It admits an independently verified authority snapshot, validates role-scoped non-Web execution assignments, requires trusted controller operation time when a transition is time-sensitive, and emits immutable self-describing terminal evidence.

The module is deliberately default-off. Loading its source does not select a controller runtime, grant consent, start an executor or worker, or perform repository, review, governance, merge, deployment, or provider mutation. Web remains the sole finality authority; this module supplies evidence and does not certify finality.

The executable source lives at [repo/scripts/repo-loop-core/repo-loop-core.cjs](../../../repo/scripts/repo-loop-core/repo-loop-core.cjs). The versioned contracts and A1 boundary are preserved under [`_main/`](_main/).

This project publishes no generated skill, MCP, instruction, or runtime output. Convergence reducers, cumulative finding classification, non-convergence telemetry, leases, consent, activation, and provider/review integrations remain outside A1.

See [`state-machine.md`](_main/state-machine.md) for the bounded lifecycle and [`SOURCE-MANIFEST.md`](SOURCE-MANIFEST.md) for source ownership.
