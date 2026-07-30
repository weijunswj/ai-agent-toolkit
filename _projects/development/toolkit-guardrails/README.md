# Toolkit Guardrails

This first-party source module owns the canonical, host-neutral guardrail policy and pure deterministic shared engine for issue #313.

The executable runtime lives under [repo/scripts/toolkit-guardrails/](../../../repo/scripts/toolkit-guardrails/). It does not install hooks, modify host configuration, parse prose instruction files, create approvals, persist approval state, or publish into global instruction surfaces.

The module is intentionally `source_only`; its curated projection is retained for human and controller review.

See [_main/](_main/) for the canonical policy, schemas, capability matrix, contracts, and fixtures.
