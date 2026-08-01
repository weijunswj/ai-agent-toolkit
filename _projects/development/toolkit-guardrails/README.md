# Toolkit Guardrails

This first-party source module owns the canonical, host-neutral guardrail policy and deterministic classification and decision contracts for issue #313. Normalisation, repository-resolution interpretation, command classification, policy lookup, and non-approval decision calculation are deterministic components. Approval verification is stateful when it consumes replay state.

The executable runtime lives under [repo/scripts/toolkit-guardrails/](../../../repo/scripts/toolkit-guardrails/). Its replay slots are volatile, process-local, in-memory records used by approval verification; they are non-durable, non-distributed, non-cross-process, and reset when the Node.js process restarts. The module does not durably persist approval state to disk, a database, host-global storage, or a distributed service. It does not install hooks, modify host configuration, parse prose instruction files, create approvals, or publish into global instruction surfaces.

The module is intentionally `source_only`; this source-only reference is not native-host, restart-safe, or production-distributed replay protection. Its curated projection is retained for human and controller review.

See [_main/](_main/) for the canonical policy, schemas, capability matrix, contracts, and fixtures.
