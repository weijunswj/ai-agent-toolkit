# Repo Loop Core A1 State Machine

The A1 source is a contract boundary, not an active loop.

```text
SOURCE_PRESENT
    |
    v
DEFAULT_OFF_REFUSAL  -- unsupported mutation --> TYPED_REFUSAL (no side effect)
    |
    v
AUTHORITY_INPUT
    | remote evidence + exact local/remote identity
    | trusted current-operation time when time-sensitive
    | unknown owner/liveness ------------------------------> BLOCKED
    v
AUTHORITY_SNAPSHOT
    |
    +--> role-scoped non-Web assignment evidence (optional)
    +--> canonical Git-path validation
    v
TERMINAL_PACKET
    | deterministic digest + packet identity + immutable evidence
    v
WEB_RECONCILIATION_INPUT
    | Web derives finality from evidence
    v
WEB_FINALITY_AUTHORITY
```

Authority snapshots bind repository, child/PR, branch, base, merge-base, head, tree, Design Lock, risk tier, remote evidence, and any trusted operation-time evidence. Execution assignment evidence is local to an explicitly bounded non-Web role; it cannot become controller policy.

Terminal packets carry evidence, findings/disposition envelopes, blocker/deferred/classification-hold state, convergence-generation reservation, reconciliation state, contradictions, unavailable evidence, candidate action descriptions, secret classification, and their digest. They do not carry caller-authored finality conclusions.

No A1 state starts workers, grants consent, mutates branches/issues/PRs/reviews/governance, merges, deploys, or mutates external providers. Durable lease recovery and convergence/telemetry behavior are reserved for later slices.
