# A4 Independent Assurance + Web-Finality

This source-only project implements the minimum host-neutral evidence
decision surface for:

DL-S1-EXTERNAL-LEDGER-FINALITY-DECOUPLING-001-G2

It evaluates required evidence, exact-head G4 admission, the six-predicate
material-blocker rule, bounded invalidation and same-Lock repair routing,
conditional G4A eligibility, Web-owned Ready/merge readback predicates, and
the privacy-safe handoff report.

The runtime is a pure decision kernel. It does not fetch GitHub, call a Web
adapter, spawn a model, set Ready, merge, close a PR, delete a branch, or
mutate A1, A2, A3, providers, or live systems. Web remains the sole acceptance
and finality authority.

The A3 five-contract execution-loop surface remains separate and unchanged.
This project creates no new authority token, finality token, release
authority, host adapter, workflow, or A3 contract.

[Source files](_main/)
