# Generic Closure-Lease Architecture

## Purpose and boundary

This module is a source-only, default-off design for a repository-scoped closure lease. It describes controls that a future web controller could enforce; this G3 implementation does not activate, install, schedule, claim, or run that capability.

The architecture contains exactly these roles and lanes:

1. Web governance controller.
2. Closure manager.
3. Implementation/amendment worker.
4. Final pre-G4 reviewer.
5. Authoritative technical G4 reviewer.
6. Independent assurance auditor.
7. Evaluation-staging lane.

No role is granted authority by its name, route, model, harness, memory, instructions, queue position, eligibility, issue wording, completion, or merge state.

## Role and capability parity

An adapter may fill a role only after it proves the complete capability contract for that role. Capability admission covers exact authority parsing, isolated execution, bounded mutation, review/evidence behavior, failure semantics, and truthful cleanup. Native mechanisms may differ, but the externally observable contract is equivalent.

An adapter that cannot prove a required capability returns UNSUPPORTED_DELEGATION. It cannot weaken the role, substitute a route, invent identity, expand authority, or continue with reduced evidence. Provider, model, reasoning, harness, surface, and role are runtime values, never repository routing policy.

Every rendered contract requires these runtime values:

- Provider.
- Canonical base model.
- Reasoning or effort.
- Reference-family reasoning equivalent, including the runtime Sol-equivalent reasoning value.
- Harness/adapter and surface.
- Role.
- Exact repository and file scope.
- Exact base, head, tree, merge-base, Design Lock, branch, PR, review, and parent authority.
- Fast mode prohibited.
- Route/model/harness substitution prohibited.

## Admission, activation, and isolation

The web controller is the only authority that can reconcile live child, PR, parent, and chronology evidence and issue a bounded execution prompt. A missing or invalid activation returns CLOSURE_LEASE_NOT_ACTIVATED.

Design merge, toolkit installation, closure-lease activation, and pilot activation are distinct non-interchangeable grants. Instructions, saved memory, project memory, queue position, eligibility, installation, issue wording, completion, and merge cannot activate a lease or select another task.

The closure manager may hold one exact root claim for one exact repository, PR, branch, commit, tree, and Design Lock scope. Duplicate roots, cross-repository fan-out, cross-PR mutation, and unrelated child selection are rejected. Expiry stops activity and never transfers ownership. Root replacement requires explicit revocation or trusted terminal proof followed by a new exact grant.

The implementation worker runs in a fresh isolated workspace at the admitted exact head. It may mutate only the explicit file allowlist and may create only normal non-force commits on the existing branch. It cannot mutate hosted governance, review threads, issue bodies, ready state, merge state, installation, pilot state, schedules, Auto Review, or the evaluation Ledger.

## Reconciliation and worker boundaries

Every material transition reconciles the raw live bodies of the child, PR, exactly one parent entry without unrelated reordering, and one parent chronology comment. Missing, duplicate, stale, conflicting, partial, or concurrently moved surfaces return PARENT_RECONCILIATION_INCOMPLETE. No worker, reviewer, readiness, acceptance, merge, closure, next-task selection, or completion may proceed during incomplete reconciliation.

The manager orchestrates evidence collection and returns findings to web. It cannot authorise merge, suppress or reinterpret a G4 finding, self-accept, or manufacture readiness. Helpers and workers cannot perform governance writes. Parent compare-and-preserve semantics preserve unrelated content and order. Raw live bodies are authoritative; projections and fallback defaults cannot self-certify readiness or completion.

## G4 and assurance

Exactly one authoritative technical G4 verdict exists for an exact head. The G4 reviewer uses a newly isolated context. A head change invalidates the old verdict and requires a fresh G4. G4 alone returns technical PASS or AMEND; the manager cannot overrule it, suppress findings, reinterpret AMEND as PASS, or self-accept.

Applicable G4 findings remain binding. Conflicting, impossible, scope-expanding, or authority-expanding findings return to web. A consolidated amendment never bypasses fresh G4, and non-convergence returns to web under the defined repair boundary.

Only after G4 PASS and ordinary web adjudication may the independent assurance auditor run. It returns only CLEAR or CONCERN; it is not a second G4 and cannot authorise merge. CONCERN blocks acceptance until web adjudicates it. Memory, Custom Instructions, and pasted conclusions are context only, never repository evidence.

## Finality and no automatic continuation

Final-audit eligibility is derived from every lifecycle section and requires every material child exactly once with preceding work terminal. Completion, merge, queue position, and eligibility never activate or select a next task. Only an explicitly named pilot may be activated before pilot acceptance, and cross-repository and cross-PR mutation remain prohibited.

The design remains uninstalled, unscheduled, and inactive in this PR. Source outputs and allowed generated writes are empty.
