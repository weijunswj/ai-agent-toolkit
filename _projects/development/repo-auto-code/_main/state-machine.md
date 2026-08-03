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
