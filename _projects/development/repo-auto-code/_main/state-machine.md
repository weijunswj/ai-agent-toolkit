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
| TEMPORARY_ASSURANCE_PENDING | Final exact-head G4 PASS plus independent Web verification | Fresh read-only Temporary Chat may inspect evidence | Auditor returns CLEAR or CONCERN only |
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
| TEMPORARY_CHAT_REQUIRED | Final exact-head technical PASS and independent Web verification are recorded | Create exactly one fresh Web Temporary Chat for that head | One separate read-only Temporary Chat is admitted |
| TEMPORARY_CHAT_ASSESSING | The fresh Temporary Chat is separate from all implementation, Executor-root, Web Orchestrator, and G4 contexts | Independently assess bounded evidence and record both execution identities plus diversity | The Temporary Chat returns CLEAR or CONCERN only |

G4 is a technical-review function, not a structural model name. The G4 assignment may differ from the Web controller assignment; neither model nor role identity grants authority. A Temporary Chat is not G5 and cannot replace G4. G4 PASS remains necessary but is insufficient for CLEAR.

The Temporary Chat is invalid if it trusts only the G4 packet or self-attestation, omits either execution identity, omits the diversity record, uses a shared context, is duplicated for the exact head, or attempts GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority. The same model family does not remove the one-chat requirement.

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

Fast and delegation are separate permissions. The four valid structured outcomes are root-only Standard, root-only Fast, Standard root plus Standard agents, and Fast root plus Fast authorised agents. A delegation grant must carry a positive finite integer `max_agents`, and every requested count must be a positive finite integer no greater than that value.

The hook does not parse natural-language speed phrases. `SubagentStart` is audit-only and cannot prevent or satisfy pre-launch admission. Specialised or bypass paths are denied or explicitly unsupported. The source-only PR defines this contract and deterministic reference behaviour but does not install or activate a native hook.
