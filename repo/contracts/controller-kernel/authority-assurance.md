# C1 Authority and assurance contract

This contract is the cold-path authority record for the Controller kernel. It
does not create a distributed lock, lease, scheduler, or Repository Loop
Manager. C1 records invariants that later state and executor work must enforce.

## Route identity

The authoritative requested route identity is exactly `provider + model +
reasoning`, plus controls that the runtime can actually enforce and verify.
Service treatment, latency, and usage are observational metadata only. Missing
observation is `unavailable`, never an inferred value.

Every admitted execution thread binds the explicitly trusted selected stack,
selection source, harness identity as capability/adapter context when
available, exact registry revision and digest, and resolved stage route. An
unavailable or unverifiable route is `ROUTE_UNAVAILABLE`; it never silently
substitutes another model or reasoning level and never consumes repair budget.

## Selection and ownership

Stack selection is explicit trusted selected-stack only. A hook, adapter, or
harness can provide capability context, but cannot select or manufacture stack
authority. There is no default stack, silent fallback, service-tier authority,
or harness-to-stack translation. Missing, stale, mismatched, or unavailable
selection is `ROUTE_UNAVAILABLE` and remains outside repair budget.

The active symbolic roles are `G0-A`, `G0-B`, `G1`, `G2`, `G3`, `G4`, `LOOP`,
`RECONVERGENCE`, `FINAL_AUDIT`, and `BROWSER`. Only `G0-B` and `G3` may
resolve semantic subagent routes; all other roles are leaf-only.

Active overlapping Toolkit work is durably human-owned across GitHub users and
controllers. Another user or controller encountering that overlap remains
read-only until an explicit handover or explicitly authorised concurrency is
recorded. Timeout, heartbeat loss, inactivity, labels, status, and executor
replacement never transfer human ownership. Ambiguous or competing ownership
is `USER_DECISION_REQUIRED`.

## Execution boundary

Before accepted A2, the supported path is `Web -> direct executor -> Web
reconciliation`. C1 does not require or invoke the planned Repository Loop
Manager. After A2 acceptance, a Loop may perform the equivalent already-
authorised reconciliation; that later mechanism does not change C1 authority.

## Terminal evidence

Worker process success is not terminal completion. Before `TERMINAL` or
`GATE_COMPLETE`, a complete self-sufficient terminal packet must validate
against the C1 schema and have a stable identity, digest, and durable retrieval
reference. A missing, truncated, malformed, or unverifiable packet is
`TERMINAL_PACKET_INCOMPLETE`.

If worker completion and packet production succeeded but model or chat delivery
was lost, consumers retrieve and replay the exact packet by identity. They do
not rerun the worker. The next gate binds that exact packet identity and
independently verifies that its repository, Lock, candidate, and live-state
applicability remain current.
