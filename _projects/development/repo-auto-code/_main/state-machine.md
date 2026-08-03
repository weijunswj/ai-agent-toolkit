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
- During G4_AMENDING, the authoritative reviewer cannot reply to or resolve threads. A bounded technical reply is allowed only after final exact-head PASS, and thread resolution is never allowed.
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

- Missing, duplicate, cross-task, cross-repository, cross-PR, replaced, or unverifiable surfaces return SURFACE_TOPOLOGY_INVALID and prohibit dispatch, G4, assurance, acceptance, merge, closure, activation, and next-task selection.
- A retained, dirty, inherited, or ambiguous subordinate workspace after adoption returns SURFACE_TOPOLOGY_INVALID. The A6-C2 source-only bootstrap continuation is not a runtime exception.
- A Temporary Chat before final exact-head PASS or before independent Web verification returns SURFACE_TOPOLOGY_INVALID. Temporary Chat may return only CLEAR or CONCERN and has no hosted or finality authority.
- The Web Orchestrator resolves exactly one complete assignment from the latest applicable current-chat instruction or, only when none exists, the complete unambiguous canonical Custom Instructions source. Partial, ambiguous, conflicting, mixed, unbound, inferred, or alternative assignments return MODEL_ASSIGNMENT_REQUIRED.
- Every prompt records assignment source and assignment evidence locator. Model, role, reasoning, and surface identity never grant controller authority.
