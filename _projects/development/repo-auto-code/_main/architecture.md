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
- Assignment source and assignment evidence locator.
- Fresh subordinate run ID and fresh workspace evidence locator.
- Fast mode and delegation admission values rendered from the structured current-turn grant.
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

The external-review trigger identity is the tuple repository + PR + exact head SHA + external-review capability. A review is usable only when authoritative hosted evidence proves the supported review type, actor, and mechanism, binds all four identity values to the current exact head, and gives exactly one unambiguous pending or completed state. Candidate-supplied labels, capability strings, and `rawEvidence` flags are not capability proof. Unbound, duplicate, ambiguous, stale, or otherwise unusable review evidence never satisfies the gate.

For one unchanged identity, one usable pending review suppresses another trigger. One usable completed review is consumed for that identity; its findings are adjudicated without retriggering another review on the same head. Review or model limit exhaustion returns REVIEW_LIMIT_EXHAUSTED and never implies review success. A materially amended head creates a new identity and requires one new usable external review and one newly isolated authoritative G4.

The authoritative G4 reviewer is the sole technical source of PASS or AMEND and never implements repository changes. During every AMEND cycle it returns one complete finding batch to the closure manager and must not reply to or resolve review threads. Only when the phase is explicitly FINAL, the verdict is PASS, and every final exact-head prerequisite is satisfied may that reviewer issue a bounded, evidence-backed technical reply; every review thread remains unresolved, and the reviewer never marks ready, accepts, merges, closes, deletes a branch, installs, activates a pilot, or selects another task.

After final exact-head technical PASS, web must independently reread and verify the exact repository, branch, base, head, tree, complete commit graph, cumulative diff, file allowlist, source-only boundary, local validation, hosted checks, every review submission and thread, every finding-to-code/test/evidence mapping, and the absence of authority or governance movement. Assurance is ineligible until that web verification is complete.

The independent assurance context returns only CLEAR or CONCERN. It is not a second G4, cannot return PASS or AMEND, authorise merge, mutate hosted state, or select another task. CLEAR permits web to complete truthful review finality but does not authorise merge. On CONCERN, web must independently reply to and resolve every thread for every finding proven addressed, duplicate, stale, or not applicable, leaves concern-related, newly actionable, or insufficiently proven findings open, and returns only that remaining set to the review loop. Previously resolved threads remain resolved unless a later amendment regresses the relevant behavior or contrary evidence proves the disposition wrong; only web may reopen them.

Ordinary findings and a provably terminated non-mutating worker remain inside the closure loop. Return to web is reserved for a genuine closed blocker: INTERRUPTED_SESSION_OWNERSHIP, EXACT_AUTHORITY_MOVEMENT, scope or Design Lock conflict, REVIEW_LIMIT_EXHAUSTED, NON_CONVERGENCE, secret exposure or required rotation, or a genuine user/controller decision.

Only after G4 PASS, the mandatory web verification and ordinary web adjudication may the independent assurance auditor run. It returns only CLEAR or CONCERN; it is not a second G4 and cannot authorise merge. CONCERN blocks acceptance until web adjudicates it. Memory, Custom Instructions, and pasted conclusions are context only, never repository evidence.

## Finality and no automatic continuation

Final-audit eligibility is derived from every lifecycle section and requires every material child exactly once with preceding work terminal. Completion, merge, queue position, and eligibility never activate or select a next task. Only an explicitly named pilot may be activated before pilot acceptance, and cross-repository and cross-PR mutation remain prohibited.

The design remains uninstalled, unscheduled, and inactive in this PR. Source outputs and allowed generated writes are empty.

## A6 target topology and model-source authority

This three-surface topology is target behaviour only after separate source acceptance, design merge, toolkit installation, and explicit activation. A source change is not source acceptance. Source acceptance, design merge, installation, and activation are distinct non-interchangeable grants; none implies another. This source-only PR remains uninstalled, unscheduled, inactive, and unable to activate these surfaces.

When any adoption or activation grant is incomplete, the controller must first prove that no active or persistent surface exists; a present surface is a topology failure, not benign source-only inactivity. After activation, persistent topology contains exactly one Web Orchestrator and one Executor-root, no unknown surface type, and no extra persistent surface. The Temporary Chat is the separately admitted third surface only after final exact-head PASS and Web verification.

### Surface 1 - Persistent Web Orchestrator

Exactly one persistent Web Orchestrator exists for each governed task or PR. It exclusively owns architecture, Design Locks, provider/model/reasoning assignment, dispatch, hosted governance, review disposition, exact-head acceptance, assurance eligibility, ready state, merge, closure, branch deletion, installation, activation, and next-task selection. No other surface or identity acquires controller authority.

### Surface 2 - Persistent Executor-root

Exactly one persistent Executor-root exists for each governed task or PR after adoption and activation. It coordinates only prompt-bounded implementation, amendment, pre-G4, and G4 runs. The subordinate run kind allowlist is exactly implementation, amendment, pre-G4, and technical G4. Every subordinate run starts fresh in its own independently clean exact-authority worktree or equivalent isolated checkout. The Executor-root may collect and reconcile evidence packets, but persistence does not authorize implementation, controller decisions, hosted governance, thread replies or resolution, acceptance, ready state, merge, closure, installation, activation, or next-task selection.

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

The Temporary Chat is separate from the Web Orchestrator, Executor-root, implementation, amendment, and technical G4 runs. It independently assesses bounded exact-head evidence and must not treat a G4 packet or reviewer self-attestation as proof. Both its G4 and Web execution identities must include provider, canonical model, reasoning, assignment source/provenance, role, surface, and exact head. Its record must explicitly list separation from every prohibited context and contain a cross-provider/model diversity record. Diversity is informative only: the Temporary Chat remains mandatory when both executions use the same model family. It may return `CONCERN` after G4 `PASS`, so G4 `PASS` is necessary but insufficient for `CLEAR`.

The Temporary Chat returns only `CLEAR` or `CONCERN`. It is not G5, does not replace G4, and has no GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority.

## A6-C6 mechanically enforced assurance boundary

The Web Orchestrator may create a Temporary Chat only from a mechanically validated `assurance-launch/v1` envelope. The envelope is bound to the repository, pull request, branch and merge state, exact base, head, tree and commit graph, the technical G4 execution identity, the Web verification execution identity, the launch run/session/turn identity, the canonical assurance-template revision, the evidence-universe revision or digest, and a created/expiry/one-use lifecycle. A missing, expired, replayed, consumed, or mismatched envelope creates no Temporary Chat.

The envelope must carry one authoritative raw-evidence record for each mandatory assurance domain: live repository/PR/branch/merge state; exact base/head/tree/graph; cumulative diff and file allowlist; source-only/install/activation boundary; required local validation; required hosted checks bound to the exact head; review submissions; every review thread with resolution and outdated state; finding-to-code/test/evidence mappings; parent/child/PR/chronology reconciliation; authority or governance movement after verification; and any required archive, digest, Ledger, or related issue state. Each record identifies the exact locator, resolved evidence identity or digest, what Web inspected, and access/limitation state.

Only authoritative raw records can satisfy a mandatory domain. Controller or Web narratives, G4 packets, executor terminal packets, copied hashes or counts, reviewer self-attestation, another actor's conclusion, memory, Custom Instructions, candidate labels, and generic or circular links are context only. A locator label without an exact inspected subject and evidence identity is not proof.

Launch admission fails closed with `WEB_VERIFICATION_REQUIRED`, `ASSURANCE_EVIDENCE_INCOMPLETE`, `ASSURANCE_HEAD_MISMATCH`, `ASSURANCE_TEMPLATE_REQUIRED`, or `ASSURANCE_LAUNCH_INVALID` as applicable, and no Temporary Chat is created. The dispatch is rendered only from the accepted canonical assurance template revision plus the admitted envelope; freehand replacement with a narrative-consistency task is invalid.

The Temporary Chat returns a mechanically validated `assurance-evidence/v1` receipt, never a bare verdict. The receipt records exactly `CLEAR` or `CONCERN`, repository/PR/base/head/tree, launch-envelope identity, Temporary Chat identity and assignment provenance, technical G4 identity, complete prohibited-context separation evidence, every mandatory check with an authoritative locator, evidence identity or digest, what was inspected, result, contradiction or limitation, missing-evidence list, final head recheck, creation identity/time/sequence, and a non-authority attestation. Web rejects a bare or unsupported `CLEAR` as `ASSURANCE_CLEAR_UNSUPPORTED`, treats the operational result as `CONCERN`, and never converts it into technical AMEND, G5, or merge authority.

## Cumulative semantic invariants

Every accepted safety property is a cumulative invariant. The machine-readable registry in `protocol.md` is the canonical contract; every record has an invariant ID, source authority, complete required semantics, candidate evidence, a concrete executable or mechanically validated negative test, status, and an authorising Design Lock. Later amendments and compression preserve each record unless a Design Lock names the invariant, states a validated replacement or disposal contract, and gives the rationale. Parsed repeated findings and invariant records carry `regression_of` to a known source invariant ID. The evaluation-candidate evidence mapping is explicit and mechanically checked against the canonical template schema.

Missing, incomplete, weakened, keyword-only, or otherwise non-semantic evidence returns `INVARIANT_REGRESSION`. Accepted review findings become permanent invariant obligations even after a thread is resolved, out-dated, or superseded. A repeated finding records `regression_of` rather than creating a disposable duplicate. Compression must pass both its mechanical budget/format gate and its independent semantic-invariant preservation gate.

Completion of exact-head external review is a material transition. Before any next prompt, technical G4, or finality, Web reconciles the child body, PR body, exactly one parent entry, and one new parent chronology comment. Stale review state blocks progression even when a prior body or thread appears complete.

## Default-deny execution admission and pre-launch hook

Without an explicit current-turn structured grant, Fast is disabled and `Agent`, `spawn_agent`, subagents, and equivalent delegation are denied. Fast and delegation are separate permissions: both false means root-only Standard; Fast only means root-only Fast; delegation only keeps root and agents Standard; both true permits authorised agents to use Fast within the exact grant. Silence, prompt omission, generic speed wording, prior-turn permission, and standing permission do not grant either capability. Unsupported or unverifiable enforcement falls back to root-only Standard execution.

Only the Web Orchestrator may create a short-lived, current-turn grant after an explicit current-turn user request. The grant is bound to the exact `run_id`, `session_id`, current `turn_id`, issuer, user-request proof, operation, `allow_fast`, `allow_agents`, maximum agent count, provider, canonical model, reasoning, expiry, consumption state, and `inheritance: false`. The grant is consumed only by the bound operation, cannot be replayed or inherited, and is invalid for another run, session, model, reasoning level, or agent count. The hook does not interpret natural-language speed phrases; the Web controller creates the structured grant only after the explicit request is verified.

For supported ordinary `Agent` or `spawn_agent` calls, admission uses an installed trusted pre-launch `PreToolUse` hook matching those operations. Denial occurs before launch. `SubagentStart` is audit-only and never prevention. Installed hook identity, exact bytes, version, trust, and runtime coverage must be verified before enforcement is claimed. A missing, stale, malformed, untrusted, or unsupported hook returns root-only Standard mode. Specialised or bypass launch paths are denied or explicitly classified unsupported and cannot silently bypass admission.

This PR contains only the source contract and deterministic reference behaviour. It does not install, activate, or claim that a native host hook is operational; host-specific installation and adapter wiring remain separately governed.
## A6-C7 normal finality and Web sole final authority

This section supersedes earlier normal-path assurance wording. The normal path does not require a Temporary Chat or a CLEAR/CONCERN result. It is ordered and conjunctive: review/amend convergence, one fresh exact-head technical G4 `PASS`, a complete terminal packet, and a comprehensive independent Web final gate.

Web is the sole comprehensive final authority. Web may return `AMEND` directly for any missing, stale, contradictory, moved, out-of-scope, or insufficiently evidenced predicate. Root, manager, implementation/amendment worker, pre-G4 reviewer, technical G4 reviewer, and independent assurance auditor are evidence-only surfaces; any claim by them of finality, acceptance, merge, closure, waiver, or Web authority is a contradiction and blocks finality.

The exact-head C7 predicate binds current child, PR, relevant parent-entry, Design Lock, scope, base, head, tree, review/check state, G4 PASS, terminal packet, and comprehensive Web inspection. Relevant authority movement requires re-admission and a fresh G4 where applicable. A second reviewer is exceptional only after an explicit pre-dispatch Web grant for cryptography, recovery, irreversible or destructive migration, a critical security boundary, or conflicting evidence. It is fresh, isolated, read-only, non-authoritative, and cannot replace Web finality.

## A6-C8 machine authority, leases, and sensitivity

The source-only C8 machinery uses deterministic `toolkit-authority-snapshot/v1`, separate immutable one-run `toolkit-authority-lease/v1`, exact `toolkit-authority-manifest/v1`, and typed `toolkit-admission-receipt/v1` records. Snapshots use canonical UTF-8 JSON, sorted keys and normalized path/capability arrays, SHA-256 digests, full 40-character Git object IDs, and no lease/timestamp/lifecycle fields.

A snapshot includes repository, child/PR revisions, cumulative Design Lock, canonical base, exact remote head/tree, authorised path/blob inventory, source-only scope, role/capabilities, and a relevant task-authority projection. The projection is child-keyed and includes only the relevant parent marker; unrelated sibling-parent movement is non-invalidating. Parent entries use deterministic `toolkit-authority-parent-entry/v1` markers and reject missing, duplicate, nested, ambiguous, or mismatched markers.

A lease is DRAFT -> SEALED -> DISPATCHED -> ADMITTED -> COMPLETED or terminal rejection. Sealed leases are immutable and one-run. Duplicate dispatch, active-lease conflict, expiry, replay, consumed reuse, stale child/PR/parent authority, malformed manifests, malformed full SHAs, machine GitHub/local mismatch, and digest mismatch return typed receipts with `mutation_performed:false`. Pre-dispatch tooling failure creates no evaluation candidate.

Manifest rendering and extraction are byte-for-byte and digest-checked; duplicate JSON fields, truncation, alteration, delimiter corruption, and prompt render/extract mismatch fail closed. Visible output is classified as `none`, `possible`, or `confirmed`; possible output is redacted and pauses only the affected Web path, while confirmed credential exposure receives evidence-based rotation handling and confirmed non-credential exposure receives containment. Values are never repeated, and unrelated work is invalidated only for demonstrated shared exposure. C8 does not install, activate, schedule, enable Auto Review, select a next task, or introduce credentials.

## C10 alpha review-request boundary

C10 is a source-only, default-deny boundary for all generic GitHub writers. Every final outbound byte sequence is Unicode-normalised and inspected for direct, case-folded, zero-width-obfuscated, quoted, fenced, or encoded forms of the configured review invocation before any mutation. A match fails closed with the typed code `CODEX_TRIGGER_TOKEN_FORBIDDEN`; the raw invocation is never stored in tracked source, tests, fixtures, templates, prompts, logs, terminal packets, commit messages, issue text, or PR text.

Exactly one dedicated structured operation may construct the invocation internally. It is unavailable to Web, the bootstrap manager, ordinary writers, and implementation/amendment workers. Admission requires the authoritative technical G4 role, the exact repository and PR, the exact admitted head and tree, terminal-success checks, an exact one-run grant, per-head idempotency, no prior request for that material head, immediate comment readback, durable grant consumption, and a PR-conversation target. this source-only run does not exercise this live operation.

The later technical G4 closure state machine is: inspect all applicable historical/current findings; verify genuine repair at the admitted head; admit at most one configured request per materially different head; await native review completion; adjudicate findings; route accepted amendments; and, only in FINAL after exact-head PASS, post bounded evidence-backed replies. G4 never resolves, reopens, dismisses, or otherwise changes conversations and never marks ready, merges, closes, or claims Web finality. Review-allowance exhaustion is a blocker, never PASS. Web alone owns conversation resolution and finality.
