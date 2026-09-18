# C1 Authority and assurance contract

This contract is the cold-path authority record for the Controller kernel. It
does not create a distributed lock, lease, scheduler, or Repository Loop
Manager. C1 records invariants that later state and executor work must enforce.

## Route identity

The authoritative requested route identity is exactly `provider + model +
reasoning`, plus controls that the runtime can actually enforce and verify.
Service treatment, latency, and usage are observational metadata only. Missing
observation is `unavailable`, never an inferred value.

Every admitted execution thread binds the selected stack, selection source,
verified harness identity when available, exact registry revision and digest,
and resolved stage route. An unavailable or unverifiable route is
`ROUTE_UNAVAILABLE`; it never silently substitutes another model or reasoning
level and never consumes repair budget.

## Selection and ownership

Selection precedence is explicit current-thread User/Web choice, then an
owner-authorised verified harness policy, then `USER_DECISION_REQUIRED`.

The owner policy is fixed for this contract:

- `claude-code` -> `owner-claude`;
- `codex` and `opencode` -> `owner-openai`;
- unknown or unverifiable harness -> `USER_DECISION_REQUIRED`.

Explicit User/Web selection always wins. A hook or adapter can declare a
verified harness, but cannot replace an explicit selection.

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
