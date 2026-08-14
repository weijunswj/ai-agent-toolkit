# Default-Off State Machine

The state machine is descriptive source material. This PR does not install or activate it.

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| INACTIVE | No explicit exact grant | No lease activity or mutation | Web issues an exact grant after reconciliation |
| ADMITTED | Exact grant and capability proof | Bind route values, authority, scope, and fresh workspace | All raw surfaces still match |
| RECONCILING | Material transition requested | Read child, PR, one parent entry, and chronology | Four-surface reconciliation is complete |
| READY_FOR_WORK | Exact head and allowlist admitted | Worker may inspect and mutate only scope | Worker returns coherent commit evidence |
| AMENDING | Candidate head differs from admitted head | Reconcile, validate, and preserve findings | New exact head is recorded |
| PRE_G4 | Worker evidence is complete | Pre-G4 reviewer reports observations only | Web adjudication accepts review input |
| G4_PENDING | Exact head has no valid verdict | Newly isolated technical review | Sole G4 returns PASS or AMEND |
| G4_PASS_RETURN | Sole G4 PASS and web adjudication complete | Prepare assurance evidence | Assurance is eligible |
| ASSURANCE_PENDING | G4 PASS plus ordinary web adjudication | Auditor returns CLEAR or CONCERN | CLEAR or web adjudicates CONCERN |
| TERMINAL | All lifecycle sections and children are terminal | Report evidence to web; no next-task selection | Explicit separate grant is required for any future work |

Guards apply on every transition:

- A changed head invalidates every prior G4 verdict.
- Missing or invalid activation returns CLOSURE_LEASE_NOT_ACTIVATED.
- Missing capability returns UNSUPPORTED_DELEGATION.
- Authority movement returns EXACT_AUTHORITY_MOVEMENT.
- Incomplete four-surface reconciliation returns PARENT_RECONCILIATION_INCOMPLETE.
- Scope expansion returns SCOPE_AMBIGUITY.
- Expiry stops activity and never transfers ownership.
- Completion, merge, eligibility, queue position, and issue wording cannot activate or select a next task.
- Installation and scheduling are not transitions in this source-only PR.

## A4 review-loop states

The following states extend the descriptive machine without installing or activating it:

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| REVIEW_IDENTITY_BOUND | Exact repository, PR, head, and external-review capability are bound | Read raw review evidence and classify the exact identity | A usable pending/completed review is found, a new review is required, or a closed blocker is returned |
| EXTERNAL_REVIEW_PENDING | One usable review is pending for the unchanged identity | Suppress duplicate triggering and await its result | Usable completion is recorded, unusable evidence is rejected, or a limit blocker is returned |
| EXTERNAL_REVIEW_CONSUMED | One usable review completed for the unchanged identity | Adjudicate its findings without retriggering on that head | Findings are adjudicated and G4 is eligible |
| G4_PENDING | Exact head has no valid verdict and the review gate is satisfied | Newly isolated technical review | Sole G4 returns PASS or AMEND |
| G4_AMENDING | Sole G4 returned AMEND | Return one complete finding batch to the manager; no thread replies or resolutions | A materially amended head creates a new review identity |
| G4_PASS_RETURN | Sole G4 PASS on the final exact head | Give the complete evidence package to web | Web records independent pre-assurance verification |
| WEB_VERIFICATION_REQUIRED | Final exact-head G4 PASS exists but web verification is not recorded | Web rereads exact authority, graph, diff, scope, checks, reviews, threads, mappings, and movement | Verification is complete or a closed blocker is returned |
| ASSURANCE_PENDING | Final G4 PASS, ordinary web adjudication, and web verification are complete | Auditor returns CLEAR or CONCERN only | CLEAR permits web finality; CONCERN enters web concern adjudication |
| WEB_CONCERN_ADJUDICATION | Assurance returned CONCERN | Web disposes only independently proven unrelated findings and leaves concern-related or insufficiently proven findings open | Remaining concern set returns to the review loop, or web records truthful non-acceptance |

Additional A4 guards:
- A changed head invalidates the prior review identity, consumes no old review, and requires a new usable external review plus a newly isolated G4.
- One usable pending review suppresses a duplicate trigger; one usable completed review is consumed without retriggering on the same exact head.
- Unbound, ambiguous, stale, or unusable review evidence never satisfies the review gate; review/model limit exhaustion returns REVIEW_LIMIT_EXHAUSTED.
- During G4_AMENDING, the authoritative reviewer cannot reply to or resolve threads. A bounded technical reply is allowed only when the phase is explicitly FINAL, final exact-head PASS prerequisites are all satisfied, and the reply is evidence-bound; thread resolution is never allowed.
- Assurance cannot begin before WEB_VERIFICATION_REQUIRED is satisfied. CLEAR is non-authoritative and not merge authority; CONCERN returns only the remaining concern set to the review loop.
- Previously resolved threads stay resolved unless regression or contrary evidence is proven, and only web may reopen them.

## A6 target topology states

These target states are descriptive only. They become eligible only after separate source acceptance, design merge, toolkit installation, and explicit activation. This source-only PR does not enter them.

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| ADOPTION_REQUIRED | Source exists without all separate grants | Record the missing acceptance, merge, installation, or activation grant | All required grants are explicit, or remain source-only |
| WEB_ORCHESTRATOR_ACTIVE | Exactly one persistent Web Orchestrator is bound to one task or PR | Own controller authority and resolve dispatch assignments | Authority moves or topology becomes invalid |
| EXECUTOR_ROOT_ACTIVE | Exactly one persistent Executor-root is bound to the same task or PR | Coordinate evidence packets and fresh subordinate runs only | Duplicate, cross-task, or authority-expanding root appears |
| FRESH_SUBORDINATE_RUN | New prompt-bounded run, complete assignment, clean exact-authority workspace | Implement or review only the assigned role and scope | Run ends, head changes, or freshness/evidence fails |
| TEMPORARY_ASSURANCE_PENDING | Final exact-head G4 PASS, independent Web verification and exact exceptional assurance grant | Fresh read-only Temporary Chat may inspect evidence | Auditor returns CLEAR or CONCERN only |
| TEMPORARY_ASSURANCE_RESULT | Fresh Temporary Chat returned CLEAR or CONCERN | Web adjudicates finality or remaining concerns | No merge or selection follows automatically |

Additional A6 guards:

- Missing, duplicate, cross-task, cross-repository, cross-PR, replaced, unknown-type, extra, or unverifiable surfaces return SURFACE_TOPOLOGY_INVALID and prohibit dispatch, G4, assurance, acceptance, merge, closure, activation, and next-task selection. After activation the persistent count is exactly one Web Orchestrator plus one Executor-root; the Temporary Chat is separately counted only after its finality prerequisites.
- If adoption or activation grants are incomplete, any active or persistent surface returns SURFACE_TOPOLOGY_INVALID instead of SOURCE_ONLY_INACTIVE.
- A retained, dirty, inherited, or ambiguous subordinate workspace after adoption returns SURFACE_TOPOLOGY_INVALID. The A6-C2 source-only bootstrap continuation is not a runtime exception.
- A Temporary Chat before final exact-head PASS or before independent Web verification returns SURFACE_TOPOLOGY_INVALID. Temporary Chat may return only CLEAR or CONCERN and has no hosted or finality authority.
- The Web Orchestrator resolves exactly one complete assignment from the latest applicable current-chat instruction or, only when none exists, the complete unambiguous canonical Custom Instructions source. Partial, ambiguous, conflicting, mixed, unbound, inferred, or alternative assignments return MODEL_ASSIGNMENT_REQUIRED.
- Every prompt records assignment source, assignment evidence locator, fresh subordinate run ID, and fresh workspace evidence locator. Model, role, reasoning, and surface identity never grant controller authority.
- Subordinate run kinds are allowlisted to implementation, amendment, pre-G4, and technical-g4 only.

## A6-C3 technical G4 and fresh assurance states

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| TECHNICAL_G4_ASSIGNMENT | Exact head is bound and one complete G4 assignment is resolved independently | Record the technical G4 provider, canonical model, reasoning, assignment source, and execution identity | Assignment is complete and the fresh G4 context is isolated |
| TECHNICAL_G4_PASS | The technical G4 reviewer returns PASS for the final exact head | Web independently verifies bounded exact-head evidence | Web verification is complete |
| EXCEPTIONAL_ASSURANCE_GRANT_REQUIRED | An exact pre-dispatch assurance grant and final-head Web verification are recorded | Create one fresh Web Temporary Chat only for that admitted exception | One separate read-only Temporary Chat is admitted |
| TEMPORARY_CHAT_ASSESSING | The fresh Temporary Chat is separate from all implementation, Executor-root, Web Orchestrator, and G4 contexts | Independently assess bounded evidence and record both execution identities plus diversity | The Temporary Chat returns CLEAR or CONCERN only |

G4 is a technical-review function, not a structural model name. The G4 assignment may differ from the Web controller assignment; neither model nor role identity grants authority. A Temporary Chat is not G5 and cannot replace G4. G4 PASS remains necessary but is insufficient for CLEAR.

The Temporary Chat is invalid if it trusts only the G4 packet or self-attestation, omits either execution identity, omits the diversity record, uses a shared context, is duplicated for the exact head, or attempts GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority. The same model family does not waive the exact exceptional assurance grant.

## A6-C6 assurance launch and receipt states

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| ASSURANCE_LAUNCH_VALIDATING | Final exact-head G4 PASS, ordinary Web adjudication, and Web verification receipt exist | Validate the assurance-launch/v1 envelope, raw evidence domains, template revision, authority, finite trusted current time, finite created_at/expires_at values, complete ordering, expiry, and one-use state | Admitted and consumed once, or a closed launch failure is returned |
| ASSURANCE_DISPATCH_READY | Launch envelope is admitted and the canonical assurance template is exact | Render the required repository-inspection assignment and bind it to the envelope | Fresh Temporary Chat is created, or `ASSURANCE_TEMPLATE_REQUIRED` is returned |
| ASSURANCE_RECEIPT_VALIDATING | Fresh Temporary Chat returned a structured response | Validate the `assurance-evidence/v1` receipt, exact-head identity, every check, separation evidence, final recheck, and non-authority attestation | CLEAR is supported, or the operational result is CONCERN |
| ASSURANCE_CLEAR_UNSUPPORTED | Receipt claims CLEAR but its mandatory evidence is absent, generic, inaccessible, circular, narrative-only, contradicted, stale, or unsupported | Treat the result as CONCERN and return it to Web | No technical, acceptance, merge, or next-task transition follows |

Additional A6-C6 guards:

- Missing Web verification receipt returns `WEB_VERIFICATION_REQUIRED`; missing or inaccessible mandatory raw evidence returns `ASSURANCE_EVIDENCE_INCOMPLETE`.
- Stale or moved repository, PR, base, head, tree, graph, or authority returns `ASSURANCE_HEAD_MISMATCH`.
- Missing or mismatched canonical assurance-template revision returns `ASSURANCE_TEMPLATE_REQUIRED`.
- Duplicate, replayed, expired, or consumed launch envelopes return `ASSURANCE_LAUNCH_INVALID` before Temporary Chat creation.
- A bare CLEAR or CONCERN, an empty check list, a candidate `rawEvidence`/`valid`/`verified` label, a packet conclusion, a generic PR URL, or a narrative locator is not a receipt.
- A receipt that lists required evidence as missing or inaccessible cannot support CLEAR. Web returns `ASSURANCE_CLEAR_UNSUPPORTED` and records the operational result as CONCERN.

## A6-C4 invariant validation gates

Before any transition that changes review, prompt, G4, finality, or compression state, the machine validates the cumulative invariant registry. The mechanical budget/format gate runs independently from the semantic-invariant gate. Missing, partial, weakened, or keyword-only evidence returns `INVARIANT_REGRESSION`; an `amended` or `removed` record is valid only with an explicit Design Lock that names the invariant, replacement or disposal, and rationale.

Exact-head external-review completion is not complete until the child body, PR body, exactly one parent entry, and one new parent chronology comment are reconciled. Stale review state blocks the next prompt, G4, and finality. Accepted review findings remain invariant obligations after their threads are resolved, out-dated, or superseded; repeated parsed findings record `regression_of` to a known invariant. Amended invariants require a named replacement contract and removed invariants require a named disposal contract; neither requires the superseded semantic bundle byte-for-byte.

## A6-C5 execution admission states

| State | Entry guard | Allowed observation or action | Exit guard |
| --- | --- | --- | --- |
| ROOT_ONLY_STANDARD | No exact current-turn grant, or enforcement is unsupported or unverified | Deny Fast and Agent or spawn_agent launch; permit only root-owned Standard work | A valid bound grant and verified supported path are presented |
| GRANT_BOUND | Web created one exact current-turn grant after an explicit current-turn user request | Bind issuer, user-request proof, run, session, turn, operation, model, reasoning, count, expiry, consumption, and `inheritance: false` | Exact operation is admitted once or a denial is returned |
| PRELAUNCH_AGENT_CHECK | Ordinary Agent or spawn_agent request is presented | Verify the trusted `PreToolUse` hook before launch | Hook and grant both pass, or root-only denial is returned |
| ADMISSION_CONSUMED | The bound operation was admitted | Record consumption and prevent replay or inheritance | Operation ends; no second use is allowed |

Fast and delegation are separate permissions. The four valid structured outcomes are root-only Standard, root-only Fast, Standard root plus Standard agents, and root Fast plus Standard delegated children; `allow_fast` never flows to a child and every delegated child has `fastAllowed:false`. A delegation grant must carry a positive finite integer `max_agents`, and every requested count must be a positive finite integer no greater than that value.

The hook does not parse natural-language speed phrases. `SubagentStart` is audit-only and cannot prevent or satisfy pre-launch admission. Specialised or bypass paths are denied or explicitly unsupported. The source-only PR defines this contract and deterministic reference behaviour but does not install or activate a native hook.
## A6-C7 normal finality states

The C7 section supersedes earlier normal-path states that make Temporary Chat or CLEAR/CONCERN mandatory. The normal transition is:

| State | Entry predicate | Action | Success |
| --- | --- | --- | --- |
| C7_REVIEW_CONVERGED | Review/amend findings are adjudicated at one exact head | Reconcile child, PR, relevant parent entry, Design Lock, scope, and requested-reviewer state | Exact-head G4 may be requested |
| C7_G4_PASS | One fresh exact-head authoritative technical G4 returns PASS | Assemble the complete terminal packet and freeze the inspected head | Web final gate may begin |
| C7_WEB_FINAL_GATE | Web independently rereads all authoritative repository, PR, graph, diff, scope, checks, reviews, threads, mappings, and safety evidence | Evaluate every finality predicate conjunctively | C7_FINALITY_ADMITTED or AMEND |
| C7_FINALITY_ADMITTED | Every predicate is true and no contradiction, movement, hold, or unresolved required finding exists | Web records finality and may authorize the separately controlled acceptance/merge/closure boundary | Terminal packet is final |
| C7_BLOCKED | Any predicate is false, stale, contradictory, incomplete, or moved | Record the typed reason and return AMEND or hold | No acceptance, merge, closure, or candidate |

Root, manager, worker, pre-G4, technical G4, and assurance surfaces are evidence-only. Web is the sole comprehensive final authority and may return AMEND without a second technical review. A Temporary Chat is optional and exceptional only after an exact pre-dispatch grant for cryptography, recovery, irreversible/destructive migration, a critical security boundary, or conflicting evidence.

## A6-C8 authority snapshot and lease states

| State | Required input | Transition guard | Failure |
| --- | --- | --- | --- |
| AUTHORITY_MACHINE_COLLECTED | Independent GitHub and local repository/issue/PR/base/head/tree/blob/scope readback | Byte-for-byte agreement and full 40-character Git object IDs | MACHINE_AUTHORITY_MISMATCH |
| AUTHORITY_SNAPSHOT_SEALED | Canonical `toolkit-authority-snapshot/v1` bytes and SHA-256 digest | Stable relevant task projection | SNAPSHOT_DIGEST_MISMATCH |
| LEASE_DRAFT | One snapshot digest, run identity, role, capabilities, issued/expiry times | No duplicate or conflicting active lease | DUPLICATE_DISPATCH or CONFLICTING_ACTIVE_LEASE |
| LEASE_SEALED | Immutable lease fields and lease digest | One-run lifecycle and valid expiry | LEASE_INVALID |
| LEASE_DISPATCHED | Exact manifest rendered from the lease/snapshot | Pre-dispatch tooling and final authority reread pass | No evaluation candidate |
| LEASE_ADMITTED | Worker/reviewer independently re-admits exact machine authority and manifest | Relevant projection unchanged | CHILD_AUTHORITY_MOVED, PR_AUTHORITY_MOVED, PARENT_ENTRY_MOVED, HEAD_MOVED, TREE_MOVED, or SCOPE_MISMATCH |
| LEASE_COMPLETED | Admission, work, terminal packet, and final readback complete | Lease not expired, consumed, or replayed | LEASE_ALREADY_CONSUMED or LEASE_EXPIRED |

Sealed leases are immutable. Only DRAFT -> SEALED -> DISPATCHED -> ADMITTED -> COMPLETED or a terminal rejection is valid. Duplicate/replayed dispatch, consumed reuse, expiry, malformed JSON/duplicate fields, malformed SHA, prompt digest mismatch, and delimiter corruption return `toolkit-admission-receipt/v1` with `mutation_performed:false`. Pre-dispatch tooling failure creates no evaluation candidate. The durable locked store is the sole authoritative lease lifecycle. In-memory records are only non-authoritative projections replaced from the latest recovered durable generation before every read, register, admit/transition, expire, complete/consume, conflict, and replay decision; they never overwrite newer durable state.

C8 comparisons use the child-keyed relevant parent marker only; unrelated sibling-parent chronology is not part of admission. Parent markers reject missing, duplicate, nested, ambiguous, or mismatched entries. `none`, `possible`, and `confirmed` visible-output classifications redact as required; confirmed credential exposure invokes evidence-based rotation disposition, confirmed non-credential exposure invokes containment, and no observed sensitive value is repeated.

## C11 default-deny delegation and exclusive Auto-code lifecycle

This section supersedes earlier generic launch wording. No agent, subagent, helper, reviewer, managed session, parallel lane or replacement worker launches without a structured current-run grant. The grant binds exact count, mode, role, provider, canonical model, reasoning, repository, current-execution validity evidence, workspace/checkout identity, mutation scope, capabilities, run/session/turn identity, expiry, one-use state and the further-delegation boundary. Before consuming an exclusive-worker grant, the request binds exact repository, role, current execution/head/tree, workspace identity, requested count, canonical repo-relative scope, and requested capability subset; any mismatch, stale/expired/revoked/future/impossible evidence, or ungranted admin/governance capability rejects without consumption. Missing or incomplete authority returns DELEGATION_NOT_AUTHORISED. Further delegation requires a separate explicit grant.

Ordinary concurrent-helper mode remains available only under its own explicit grant and requires root work to be separate and non-overlapping. Exclusive Auto-code mode is separately selected and admits exactly one implementation/amendment worker with exclusive mutation ownership for its exact workspace and scope. The manager enters MANAGER_SUSPENDED_ON_NATIVE_WORKER and awaits the normal harness-native terminal result. Elapsed time, quiet output, absent file writes and bounded command-wait expiry are not failure signals. While the worker is active the manager must not inspect workspace progress, run overlapping validation, send status or continue nudges, interrupt for progress, take over mutation, or launch a replacement.

The manager resumes only when trusted terminal/resume evidence binds to the exact durable admitted worker launch currently owning the workspace: repository, PR/child task, run/session/turn, exact head/tree, exclusive-worker launch and grant identity with consumed/admitted state, worker identity, workspace/checkout, launch role, and terminal event identity. Static, stale, wrong-worker, wrong-workspace, replayed, incomplete, or unadmitted evidence leaves the manager suspended and transfers no mutation ownership. Normal return releases mutation ownership to the manager for validation, integration, commit and push. Replacement requires a new grant plus proven terminal failure or result loss. User interruption preserves the workspace and ownership state; it does not transfer implementation ownership automatically. This source-only module does not enable autonomous spawning.
