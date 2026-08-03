# Semantic Hook Contracts

The shared policy names exactly three host-neutral semantic contracts. This source module defines their meaning; it does not install or configure a native callback.

## `session.bootstrap`

Verify Toolkit identity, the host projection, the version-bound capability evidence, the explicit active-repository context, and the session state before the first consequential operation. Bootstrap may report `healthy`, `degraded`, or `unsupported`; it must not treat full-permission, bypass, auto, or saved native permission state as Toolkit authority.

## `operation.preflight`

Run before a consequential operation. Consume one normalized operation record and return exactly one of `allow`, `ask`, `deny`, or `unsupported`, plus a stable reason code, enforcement requirement, safe target class, and digests. Normalisation, repository-resolution interpretation, command classification, policy lookup, and non-approval decision calculation are deterministic; stateful approval verification consumes replay state. That replay state is volatile, in-memory, process-local, non-durable, non-distributed, and non-cross-process, and resets when the Node.js process restarts. It is confined to this source-only reference implementation and is not native-host enforcement, restart-safe production replay protection, or production-distributed replay protection. A host adapter must not claim `ask` unless its exact native route displays the complete request and returns trusted same-turn approval evidence. An unsupported route stops before execution.

## `operation.finalize`

This lane does not implement a general post-tool audit. A later host-specific implementation may use finalize only for a Toolkit-owned bounded transaction with an exact predeclared target set and postcondition. It may not claim to inspect arbitrary visible model output or broaden approval after execution.

## Failure contract

Missing, malformed, stale, timed-out, reordered, or unproven host evidence never becomes `allow`. A resolver or classifier exception, or an approval-verifier exception while consuming process-local replay state, produces a structured non-allow result or a hard test failure. The runtime does not parse `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or another prose file as executable policy.
