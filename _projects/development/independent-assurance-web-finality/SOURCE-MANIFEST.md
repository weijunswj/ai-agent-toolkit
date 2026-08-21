# Source Manifest: A4 Independent Assurance + Web-Finality

## Preserved in _main/

- assurance-web-finality-contract.schema.json - the source-owned
  required-evidence and report shape for the A4 handoff.
- assurance-web-finality-policy.json - the locked authority boundaries,
  decision rules, invalidation matrix, repair loop, G4A boundary, Ledger
  evidence rule, finality proof, and privacy constraints.

These are first-party source files authored for RUN-169 from the admitted
canonical A1+A2+A3 result. No third-party source is copied or adapted.

## Runtime and focused validation

- repo/scripts/toolkit-assurance-web-finality.cjs - dependency-free pure
  decision kernel. It only evaluates caller-provided evidence and returns
  bounded statuses. It has no provider, host, Web, GitHub, Ledger, Ready,
  merge, cleanup, mutation, or finality side effect.
- repo/tests/toolkit-assurance-web-finality.run169-red.test.cjs - the
  RED-first contract suite covering the required evidence predicate,
  material blocker conjunction, invalidation matrix, repair loop, G4A,
  Ledger, Ready/merge/readback, and privacy cases.
- repo/tests/toolkit-assurance-web-finality.run172-red.test.cjs - focused
  hostile regression proofs for exact evidence version, canonical findings,
  Ledger #142, finality tuple binding, and truthful handoff reports.
- repo/tests/toolkit-assurance-web-finality.contract.test.cjs - source-shape
  and boundary checks for the single A4 project and its non-expansion
  contract.
- repo/tests/toolkit-assurance-web-finality.privacy.test.cjs - focused
  safe-relative scope and bounded optional-report-field checks.

No generated or published outputs are declared. No skill, MCP, plugin,
adapter, workflow, or source-watch surface is created.

## Scope boundary

This module owns A4 evidence and handoff decision semantics only. A1 remains
the sole mutation and opaque authority-ticket authority. A2 remains consent
and state only. A3 remains execution, workspace, run, and terminal evidence
only. G4 is independent read-only assurance. Conditional G4A is bounded
read-only routing/judgement assistance. Web remains the sole acceptance and
finality authority.

It does not implement A1/A2/A3 redesign, host mechanics, provider/live work,
Web transport, workflow files, Ledger writes, Ready, merge, branch cleanup,
N5-N14, #342 propagation, #348, full #242, or broad #252 observability.
