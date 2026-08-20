# A3 Bounded Local Execution-Loop

This source-only module implements the bounded local execution-loop contract
for DL-AGENT-NATIVE-LOOP-MVP-001-A3-LOCAL-LOOP-R1.

It is default-off and root-only. A2 execution_loop=enabled is consent
only; it does not widen a task, grant mutation, launch workers, or establish
finality. Delegation requires a complete immutable route plan and every
required adapter to verify the exact provider, model, reasoning, role, and
host capability. Any unavailable lane blocks the complete launch.

A1 remains the sole operation and authority-ticket system. A3 injects a
controller/host-owned broker and never exposes an issuer, creates a second
ticket, or stores an A1 ticket. Typed git.commit is the only stage-plus-
commit operation and is executed through an injected bounded Git adapter.

Durable state is external to tracked repositories under
~/.ai-agent-toolkit/user-state/execution-loop/. Only digests, bounded
semantic IDs, safe workspace identifiers, and opaque handles are retained.
Uncertain, interrupted, dirty, or unpublished evidence is preserved or
quarantined; cleanup requires proven disposable state.

The Web remains the finality authority. Terminal packets are bounded evidence
and contain an unresolved exact-head Web handoff only.

[Canonical source](_main/)
