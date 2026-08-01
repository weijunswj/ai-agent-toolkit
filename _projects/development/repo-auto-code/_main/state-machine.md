# Repo-Scoped Scheduled Auto-Code Protocol: State Machine

## 1. State vocabulary

The state machine is reconstructed per enrolled child/PR. A repository may have several independent lanes, but each lane has one packet and one claim state.

| State | Meaning | Allowed next state |
| --- | --- | --- |
| `DISABLED` | No repository-scoped auto-code preparation or schedules are active | `PREPARED`, `INVALID` |
| `PREPARED` | Consent, skill, managed block, parent/child structure, and prompts are inspectable; schedules are still user-created | `ENROLLED`, `DISABLED`, `INVALID` |
| `MANUAL_ONLY` | PR is observable but not explicitly enrolled | `ENROLLED` only after controller/user reconciliation, or remain manual |
| `ENROLLED` | Parent, child, and PR markers agree for one lane | `CONTROLLER_TURN`, `HELD`, `COMPLETED` |
| `CONTROLLER_TURN` | Controller must reconcile state or publish the next packet | `DRAFT`, `WAITING_CHECKS`, `WAITING_USER`, `HELD`, `COMPLETED` |
| `DRAFT` | Canonical child handoff exists but is explicitly non-actionable | `READY_EXECUTOR`, `HELD`, `INVALID` |
| `READY_EXECUTOR` | Packet and all bindings were reread and agree | `CLAIMING`, `HELD`, `INVALID` |
| `CLAIMING` | Executor is verifying the packet-scoped atomic claim | `EXECUTOR_TURN`, `HELD`, `INVALID` |
| `EXECUTOR_TURN` | One L1 executor is acting under a verified claim | `RESULT_PENDING`, `HELD`, `INVALID` |
| `RESULT_PENDING` | Executor evidence exists but controller reconciliation is incomplete | `CONTROLLER_TURN`, `HELD`, `INVALID` |
| `WAITING_CHECKS` | Required checks or exact-head evidence are pending | `CONTROLLER_TURN`, `HELD`, `INVALID` |
| `WAITING_USER` | Safe private user action is required | `CONTROLLER_TURN`, `DISABLED`, `HELD` |
| `HELD` | Ambiguous, stale, conflicting, unavailable, or potentially destructive state needs repair | `CONTROLLER_TURN`, `MANUAL_ONLY`, `DISABLED`, `INVALID` |
| `COMPLETED` | All completion gates pass and no live prompt remains | `DISABLED` only after explicit schedule teardown |
| `INVALID` | Fail-closed state requiring exact repair; no substantive mutation | `PREPARED`, `HELD`, or `DISABLED` after repair |

The capability lifecycle labels below are distinct evidence states and must never be collapsed into one another. The operational states in the table above are substates and cannot skip a lifecycle prerequisite:

| Lifecycle label | Required evidence | It is not equivalent to |
| --- | --- | --- |
| `SETUP` | An explicit repository-scoped setup operation is in progress; no capability is enabled yet | `PREPARED` or `SCHEDULED` |
| `PREPARED` | Consent, inspectable source, managed block, parent/child structure, and prompts are valid; task identities remain user-created | `SCHEDULED`, `ENROLLED`, or `CLAIMED` |
| `SCHEDULED` | Both exact user-created task identities are verified for this repository and are runnable; prepared prompts alone never set this state | `ENROLLED` or `RUNNING` |
| `ENROLLED` | Parent, child, and PR binding blocks agree for one lane | `CLAIMED` or `RUNNING` |
| `CLAIMED` | A trusted atomic read-back verifies one capability-issued lease bound to the packet, executor run, and observed head | `CLAIMING` before verification or `RUNNING` |
| `RUNNING` | The assigned L1 executor is acting under the verified claim and within the assignment | `CLAIMED`, `ACCEPTED`, or `COMPLETED` |
| `ACCEPTED` | The controller reconciled the result, committed state, exact head, checks, reviews, ledger, and user obligations; merge and teardown remain separate | A result merely existing, `RUNNING`, or `COMPLETE` |
| `COMPLETE` | Finality gates pass, no live prompt/result/review obligation remains, and explicit teardown is complete | `ACCEPTED` or a prepared/scheduled prompt |

`CLAIMING`, `EXECUTOR_TURN`, `RESULT_PENDING`, and `COMPLETED` remain useful operational states, but they are not permission to infer `CLAIMED`, `RUNNING`, `ACCEPTED`, or `COMPLETE` without the evidence above.

## 2. Controller cycle

Each fresh controller run performs this order for all lanes:

1. Verify exact repository identity, protocol version, consent, skill inspectability, managed block, and schedule identity. If a second controller or executor schedule is found, fail the affected repository setup and preserve both task records for user repair.
2. Re-read parent, child, PR bodies, canonical comments, pointers, commits, live heads, checks, reviews, and claim records. Reconcile partial writes rather than assuming a previous call was atomic.
3. Reconcile matching executor results. A result without the expected committed state or exact head becomes `HELD`; it is not accepted by its existence.
4. Sweep every relevant review conversation across open, closed, and merged PRs. Disposition or carry every valid finding before publishing a new packet.
5. Reconcile `main` movement, same-PR user commits, other-PR dependencies, forbidden overlap, worktree contamination, and possible unpushed work.
6. If checks are pending, enter `WAITING_CHECKS`. If user or private context is required, enter `WAITING_USER`. If the child is complete and has no live prompt, take no action.
7. For an actionable enrolled lane, use the parent checklist order. Continue active lanes before selecting the next ready lane. Never select by PR number, recency, author, or branch prefix.
8. Generate exactly one complete packet, post it as child `DRAFT`, bind parent/child/PR, reread, and mark `READY_EXECUTOR` last. A failed reread leaves the lane non-actionable.
9. After a controller result is reconciled, redact only the transient next-worker payload. Preserve the full audit and executor evidence.

## 3. Executor cycle

Every fresh executor run:

1. Reconstructs live state and finds at most one current `READY_EXECUTOR` packet for the selected repository/lane.
2. Verifies exact packet grammar, current Gate/Design Lock, parent/child/PR identity, all three bindings, current head, review findings, checks, and no contradictory packet.
3. L0 calls `createIfAbsent` exactly once and reads back the resulting record. L1 verifies that existing record and never calls `createIfAbsent`; comment claims and expired leases are insufficient. A `created: false` result, failed read-back, or identity/head mismatch enters `HELD` without code mutation. If the primitive is unavailable, return the exact protocol response defined in `protocol.md` without code mutation.
4. Verifies that the live PR head equals the observed starting head or that the controller-authorised adoption rule is satisfied. A head movement invalidates old G4 and requires fresh inspection.
5. Performs only the assigned implementation/amendment. It preserves bounded user work, uses no force-push or history rewrite, and stops on scope, authority, architecture, secret, or worktree ambiguity.
6. Runs the assigned validation, records the exact head and commit, and emits one complete ETO result. It does not mutate issues, reviews, the ledger, or merge state.
7. Stops. The controller determines the next turn after reconciling the result.

## 4. Turn rules and lane independence

The exact turn rules are:

- Ready controller packet without matching result: executor turn.
- Matching executor result not reconciled: controller turn.
- No packet with actionable child: controller turn.
- Pending checks: `WAITING_CHECKS`.
- User action required: `WAITING_USER`.
- Missing required worker profile: blocked.
- Duplicate or contradictory authority: affected lane fails closed.
- Completed child with no live prompt: no action.

Independent enrolled PRs have independent packets, claims, heads, reviews, and results. Default substantive capacity is one L1 worker. More than one requires truthful harness capacity and explicit user configuration. Capacity exhaustion holds the selected lane without changing its authority; unrelated lanes may continue only if their dependencies and capacity rules allow it.

## 5. Manual and concurrent work transitions

| Event | Deterministic response |
| --- | --- |
| User changes another PR | Preserve it; continue only if dependency, base, architecture, and scope are unchanged |
| User fast-forwards the same PR before claim | Re-read every intervening commit and inspect the complete line-by-line diff; adopt only if applicable and authorised |
| User changes the same PR during execution | Stop at a safe boundary, preserve local work, compare exact commits/diff, integrate only clear compatible changes, rerun affected validation |
| Canonical `main` moves | Reconcile the Design Lock/base relation; invalidate affected G4 and hold if the assignment is no longer exact |
| Architecture conflicts | Hold only the affected lane and request controller G1/G2 reconciliation |
| Forbidden-scope overlap | Do not mutate the overlap; report exact files and keep unrelated lanes independent when safe |
| Ambiguous intent | `WAITING_USER`; do not choose for the user |
| Worktree contamination | Preserve bounded local files, do not reset/delete, and hold until ownership is reconciled |
| Possible unpushed worker work | Controller inspects local worktree, live head, claim, and evidence before claim retirement/supersession |

Every accepted same-PR head movement requires new focused validation and fresh exact-head G4. No prior G4 is reusable after any head movement.

## 6. Review and redaction transitions

New reviews arriving mid-run cause the controller to sweep and disposition them before the next prompt, G4, acceptance, merge, closure, or next-task selection. A valid open finding appears in the next applicable worker prompt while remediation or verification is pending.

After a result is reconciled, the controller edits only the transient next-worker payload to the exact redaction marker defined in `protocol.md`. The audit chronology, executor evidence, IDs, heads, validation, review dispositions, and durable links remain. The lane cannot enter `COMPLETED` while an unconsumed live prompt or unprocessed result exists.

## 7. Completion and teardown

The controller may mark a lane complete only when:

- no live next-worker prompt remains;
- no executor result is unprocessed;
- no valid review obligation is unresolved;
- no child, UAT, ledger, or user-action obligation is pending;
- parent, child, and PR state agree;
- exact-head acceptance is current; and
- the controller has performed the final complete review sweep.

Repository capability teardown is a separate transition. It requires explicit current user instruction to remove both schedules. The user, not setup, performs or authorises removal. The controller verifies both task identities belong to this repository, confirms no other repository is affected, records teardown, and then removes/archives the managed block only through its source-owned repair path. A paused, deleted, duplicate, or remaining task leaves teardown incomplete and blocks final completion.
