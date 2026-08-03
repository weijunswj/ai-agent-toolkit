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

## Exact-head review identity and closure loop

The external-review trigger identity is the tuple repository + PR + exact head SHA + external-review capability. A review is usable only when raw review evidence binds all four values to the current exact head, proves the external-review capability, and gives one unambiguous pending or completed state. Unbound, ambiguous, stale, or otherwise unusable review evidence never satisfies the gate.

For one unchanged identity, one usable pending review suppresses another trigger. One usable completed review is consumed for that identity; its findings are adjudicated without retriggering another review on the same head. Review or model limit exhaustion returns REVIEW_LIMIT_EXHAUSTED and never implies review success. A materially amended head creates a new identity and requires one new usable external review and one newly isolated authoritative G4.

The authoritative G4 reviewer is the sole technical source of PASS or AMEND and never implements repository changes. During every AMEND cycle it returns one complete finding batch to the closure manager and must not reply to or resolve review threads. Only after technical PASS on the final exact head may that reviewer issue a bounded, evidence-backed technical reply; every review thread remains unresolved, and the reviewer never marks ready, accepts, merges, closes, deletes a branch, installs, activates a pilot, or selects another task.

After final exact-head technical PASS, web must independently reread and verify the exact repository, branch, base, head, tree, complete commit graph, cumulative diff, file allowlist, source-only boundary, local validation, hosted checks, every review submission and thread, every finding-to-code/test/evidence mapping, and the absence of authority or governance movement. Assurance is ineligible until that web verification is complete.

The independent assurance context returns only CLEAR or CONCERN. It is not a second G4, cannot return PASS or AMEND, authorise merge, mutate hosted state, or select another task. CLEAR permits web to complete truthful review finality but does not authorise merge. On CONCERN, web must independently reply to and resolve every thread for every finding proven addressed, duplicate, stale, or not applicable, leaves concern-related, newly actionable, or insufficiently proven findings open, and returns only that remaining set to the review loop. Previously resolved threads remain resolved unless a later amendment regresses the relevant behavior or contrary evidence proves the disposition wrong; only web may reopen them.

Ordinary findings and a provably terminated non-mutating worker remain inside the closure loop. Return to web is reserved for a genuine closed blocker: INTERRUPTED_SESSION_OWNERSHIP, EXACT_AUTHORITY_MOVEMENT, scope or Design Lock conflict, REVIEW_LIMIT_EXHAUSTED, NON_CONVERGENCE, secret exposure or required rotation, or a genuine user/controller decision.

Only after G4 PASS, the mandatory web verification and ordinary web adjudication may the independent assurance auditor run. It returns only CLEAR or CONCERN; it is not a second G4 and cannot authorise merge. CONCERN blocks acceptance until web adjudicates it. Memory, Custom Instructions, and pasted conclusions are context only, never repository evidence.

## Finality and no automatic continuation

Final-audit eligibility is derived from every lifecycle section and requires every material child exactly once with preceding work terminal. Completion, merge, queue position, and eligibility never activate or select a next task. Only an explicitly named pilot may be activated before pilot acceptance, and cross-repository and cross-PR mutation remain prohibited.

The design remains uninstalled, unscheduled, and inactive in this PR. Source outputs and allowed generated writes are empty.

## A6 target topology and model-source authority

This three-surface topology is target behaviour only after separate source acceptance, design merge, toolkit installation, and explicit activation. A source change is not source acceptance. Source acceptance, design merge, installation, and activation are distinct non-interchangeable grants; none implies another. This source-only PR remains uninstalled, unscheduled, inactive, and unable to activate these surfaces.

### Surface 1 - Persistent Web Orchestrator

Exactly one persistent Web Orchestrator exists for each governed task or PR. It exclusively owns architecture, Design Locks, provider/model/reasoning assignment, dispatch, hosted governance, review disposition, exact-head acceptance, assurance eligibility, ready state, merge, closure, branch deletion, installation, activation, and next-task selection. No other surface or identity acquires controller authority.

### Surface 2 - Persistent Executor-root

Exactly one persistent Executor-root exists for each governed task or PR after adoption and activation. It coordinates only prompt-bounded implementation, amendment, pre-G4, and G4 runs. Each subordinate run starts fresh in its own independently clean exact-authority worktree or equivalent isolated checkout. The Executor-root may collect and reconcile evidence packets, but persistence does not authorize implementation, controller decisions, hosted governance, thread replies or resolution, acceptance, ready state, merge, closure, installation, activation, or next-task selection.

The Executor-root consumes a complete assignment resolved by the Web Orchestrator; it cannot select, infer, recommend, combine, or replace a model, provider, reasoning level, role, harness, surface, or authority. Model, role, reasoning, and surface identity never grant controller authority.

### Surface 3 - Fresh Web Temporary Chat

One fresh Web Temporary Chat may be created only after final exact-head technical PASS and independent Web verification of the complete evidence universe. It is read-only, fresh for that final head, and returns only CLEAR or CONCERN. It cannot return PASS or AMEND, mutate hosted governance, authorise merge, accept, select work, or acquire controller authority.

### Fresh subordinate-run rule

After adoption and explicit activation, every implementation, amendment, pre-G4, and G4 run is prompt-bounded, fresh, and independently isolated at exact authority. It receives a newly resolved assignment and does not inherit authority, context, model selection, or a retained, dirty, or ambiguous worktree merely from the persistent Executor-root. Retained-worktree reuse after activation is invalid.

### Model-assignment source authority

Before every executor, reviewer, or assurance dispatch, the Web Orchestrator resolves one complete assignment from one source only. The latest applicable complete explicit user assignment in the current persistent Web Orchestrator chat takes precedence. Only when no applicable assignment exists there may the Web Orchestrator use a complete, unambiguous current canonical Custom Instructions repository, file, ref or commit, and blob. A present but partial, conflicting, or ambiguous current-chat assignment returns MODEL_ASSIGNMENT_REQUIRED and cannot fall through. Sources cannot be mixed.

Every rendered prompt records the assignment source and assignment evidence locator, alongside provider, canonical base model, reasoning, Sol-equivalent reasoning, role, surface, exact repository, and exact authority. No model may be inferred, recommended, or introduced from memory, preference, cost, capability, benchmarks, issue wording, previous runs, previous chats, or provider availability. An unselected alternative model returns MODEL_ASSIGNMENT_REQUIRED. No dispatch occurs without a complete permitted assignment.

A6-C2 permits this one source-only G3 continuation to use the existing implementation chat and retained worktree while creating this architecture. That bootstrap fact is not a persistent Executor-root, does not activate A6, and is not a reusable runtime bypass after adoption.

## Model-neutral technical G4 and fresh Web assurance

The structural role is the `technical G4 reviewer`. G4 is a technical-review function, not a structural model name. The word authoritative describes the single exact-head verdict capability; it never names or selects a provider, canonical model, reasoning level, harness, or surface. Historical execution identities remain recorded truthfully and are not normalised into a new model label.

For every future dispatch, the Web Orchestrator resolves the technical G4 provider, canonical base model, and reasoning independently from the controlling assignment source. The G4 assignment is not inherited from the Web controller. An explicitly assigned G4 provider or model may differ from the Web controller provider or model. Model, role, reasoning, and surface identity never grant authority.

The final-head assurance order is mandatory for every final exact-head technical `PASS`:

1. The isolated technical G4 reviewer returns `PASS` for the exact head.
2. Web independently verifies the complete bounded exact-head evidence universe.
3. Web creates exactly one fresh Web Temporary Chat for that exact head.

The Temporary Chat is separate from the Web Orchestrator, Executor-root, implementation or amendment runs, and technical G4 run. It independently assesses bounded exact-head evidence and must not treat a G4 packet or reviewer self-attestation as proof. Its record contains the G4 execution identity, its own Web execution identity, and an explicit cross-provider/model diversity record when the identities differ. Diversity is informative only: the Temporary Chat remains mandatory when both executions use the same model family. It may return `CONCERN` after G4 `PASS`, so G4 `PASS` is necessary but insufficient for `CLEAR`.

The Temporary Chat returns only `CLEAR` or `CONCERN`. It is not G5, does not replace G4, and has no GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority.

## Cumulative semantic invariants

Every accepted safety property is a cumulative invariant. The machine-readable registry in `protocol.md` is the canonical contract; every record has an invariant ID, source authority, complete required semantics, candidate evidence, a negative test, status, and an authorising Design Lock. Later amendments and compression preserve each record unless a Design Lock names the invariant, states its replacement or disposal, and gives the rationale.

Missing, incomplete, weakened, keyword-only, or otherwise non-semantic evidence returns `INVARIANT_REGRESSION`. Accepted review findings become permanent invariant obligations even after a thread is resolved, out-dated, or superseded. A repeated finding records `regression_of` rather than creating a disposable duplicate. Compression must pass both its mechanical budget/format gate and its independent semantic-invariant preservation gate.

Completion of exact-head external review is a material transition. Before any next prompt, technical G4, or finality, Web reconciles the child body, PR body, exactly one parent entry, and one new parent chronology comment. Stale review state blocks progression even when a prior body or thread appears complete.

## Default-deny execution admission and pre-launch hook

Without an explicit current-turn structured grant, Fast is disabled and `Agent`, `spawn_agent`, subagents, and equivalent delegation are denied. Silence, prompt omission, generic speed wording, prior-turn permission, and standing permission do not grant either capability. Unsupported or unverifiable enforcement falls back to root-only Standard execution.

Only the Web Orchestrator may create a short-lived, current-turn grant after an explicit current-turn user request. The grant is bound to the exact `run_id`, `session_id`, current `turn_id`, issuer, user-request proof, operation, `allow_fast`, `allow_agents`, maximum agent count, provider, canonical model, reasoning, expiry, consumption state, and `inheritance: false`. The grant is consumed only by the bound operation, cannot be replayed or inherited, and is invalid for another run, session, model, reasoning level, or agent count. The hook does not interpret natural-language speed phrases; the Web controller creates the structured grant only after the explicit request is verified.

For supported ordinary `Agent` or `spawn_agent` calls, admission uses an installed trusted pre-launch `PreToolUse` hook matching those operations. Denial occurs before launch. `SubagentStart` is audit-only and never prevention. Installed hook identity, exact bytes, version, trust, and runtime coverage must be verified before enforcement is claimed. A missing, stale, malformed, untrusted, or unsupported hook returns root-only Standard mode. Specialised or bypass launch paths are denied or explicitly classified unsupported and cannot silently bypass admission.

This PR contains only the source contract and deterministic reference behaviour. It does not install, activate, or claim that a native host hook is operational; host-specific installation and adapter wiring remain separately governed.
