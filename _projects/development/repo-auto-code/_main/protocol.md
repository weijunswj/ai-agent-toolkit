# Repo-Scoped Scheduled Auto-Code Protocol

## 1. Fresh-chat reconstruction

Every controller and executor run starts with no memory. It reconstructs the current state from the installed source-owned skill, the managed repository block, the exact repository identity, the rolling parent, the direct child, the explicitly enrolled PR, commits and diffs, checks, review conversations, packet comments, claim state, and the user-owned schedule configuration. A previous chat, a prompt copied from memory, a timestamp, a lease, a comment count, or a model's inference is not authority.

The reconstruction order is:

1. Verify repository identity, origin, default branch, current head, worktree safety, and the protocol version.
2. Verify repository consent, skill presence/inspectability, and the managed block.
3. Re-read the parent, child, PR body, canonical child comments, and PR pointer.
4. Reconcile packet status, exact head, checks, reviews, claims, local work, and schedules.
5. Determine the affected lane's turn using the state machine.
6. Refuse to act on any partial, duplicate, malformed, contradictory, stale, or unbound state.

Before an Auto-code cycle continues, the controller derives separate exact-repository capability readiness. `github_issue_governance: enabled` and `repo_auto_code: enabled` must both be present; generic repository consent is insufficient. The installed #299 governance skill must be present and healthy, exactly one canonical parent must satisfy the baseline, every direct material child must occur once, parent/child/PR projections must agree, no reconciliation blocker or concurrent movement may be pending, and the actor must be authorised for the exact role. A failure returns `AUTO_CODE_GOVERNANCE_UNREADY` and prohibits claim, pickup, prompt issuance, substantive execution, governance repair from an ordinary cycle, G4, acceptance, merge, and next-task selection. Only the web controller or a supported executor explicitly assigned the exact governance/setup role may initiate or repair governance, using the same installed skill and validation contract.

## 2. Closed handoff grammar

The protocol has exactly two handoff marker names. A complete packet uses one start marker and one matching end marker, in order, with no nested packet. Metadata is intentionally minimal; facts reliably derivable from the live repository are not copied into packet headers.

Marker validation parses the complete prompt or result text, not fixture-provided counts. It derives one OTE start, one OTE end, one ETO start, and one ETO end; global ordering; a typed stack with no nesting, crossing, overlap, or hidden duplicate; and the absence of a live prompt/result after completion. One-count markers in the wrong order, extra markers later in the text, missing markers, nested envelopes, and crossed envelopes are invalid and prohibit packet consumption, redaction, or completion.

### Controller to executor packet

The canonical grammar is:

```text
[ ORCHESTRATOR TO EXECUTOR: START ]

Packet ID: OTE-<unique>
Controller Run ID: <controller-run-id>
Current gate / Design Lock: <gate and lock>
Starting authority: <repository, child, PR and exact starting-head rule>
Assigned provider: <provider>
Assigned model: <model>
Assigned reasoning: <reasoning>
Assigned role: <role>

<Complete public-safe standalone assignment>

[ ORCHESTRATOR TO EXECUTOR: END ]
```

The assignment must say what the executor may change, what it must validate, the exact current acceptance boundary, review findings that apply, the no-mutation boundaries, and the required evidence packet. It must not contain secret values or require the executor to infer another side's next step.

### Executor to controller result

The canonical grammar is:

```text
[ EXECUTOR TO ORCHESTRATOR: START ]

Responds to Packet ID: OTE-<unique>
Executor Run ID: <executor-run-id>
Prompt starting head: <sha or explicit none>
Adopted starting head: <sha or none>
Final head: <sha or unchanged>
Commit and validation: <commit and exact evidence>
Blockers: <none or exact blocker>
Secret-exposure audit: none|possible|confirmed

<Complete evidence packet>

**PRIVATE USER FOLLOW-UP REQUIRED**

Reason: <none or safe reason>
What the web controller should ask: <safe question>
Acceptable safe response: <safe response shape>
Do not provide: <secret values, credentials, environment dumps, or private context>

[ EXECUTOR TO ORCHESTRATOR: END ]
```

An executor result is permanent audit evidence. The controller may redact a transient next-worker prompt after reconciliation, but it must not redact executor evidence merely because it was processed.

## 3. Staged publication

A comment is not actionable merely because it exists. The controller must use this order for every packet:

1. Reconstruct live state and generate one unique Packet ID.
2. Post the canonical child audit/handoff comment with status `DRAFT`. `DRAFT` is non-actionable.
3. Bind the same Packet ID, turn, child, and PR in the parent checklist entry, child body, and PR body marker.
4. Re-read the parent, child, and PR bodies. If any write is missing, stale, duplicated, malformed, or contradictory, leave the packet non-actionable and issue the exact repair action.
5. Change the canonical child comment to `READY_EXECUTOR` last.
6. Re-read the child comment and every authority surface. Act only when one complete current ready packet and all three matching bindings agree.

The PR pointer is discoverability only. It cannot repair a missing child comment, make a `DRAFT` actionable, or create enrolment. A duplicate ready packet, malformed marker, partial parent/child/PR publication, or body/comment disagreement fails the affected lane closed.

### Three-surface binding grammar

The parent queue entry, child issue body, and PR body each contain exactly one copy of this closed binding block. The `Surface` value is respectively `PARENT`, `CHILD`, or `PR`; every other identity, packet, turn, and enrolment field must agree byte-for-byte across all three copies. The lines must appear in this order, with no extra fields inside the block:

```text
[ AUTO-CODE ENROLMENT: START ]
Protocol version: 1
Surface: PARENT|CHILD|PR
Repository: <canonical owner/name>
Parent issue: #<number>
Child issue: #<number>
PR: #<number>
Packet ID: OTE-<unique>|NONE
Turn: CONTROLLER|EXECUTOR|NONE
Enrolment: ENROLLED
[ AUTO-CODE ENROLMENT: END ]
```

The controller rejects a missing, duplicated, malformed, or disagreeing block. `NONE` is valid only when no packet is live; a live staged packet must carry the same Packet ID and turn in all three surfaces. This grammar is the only enrolment authority; author, branch, recency, open state, or a PR pointer cannot substitute for it.

## 4. Material-transition four-surface reconciliation

A material transition is any change to one or more of these fields:

- lifecycle section;
- status;
- gate;
- Design Lock;
- PR, branch, base, or head;
- verdict;
- checks;
- review disposition;
- blocker;
- required user action;
- current turn;
- immediate next action;
- acceptance;
- merge;
- closure; or
- completion.

Every material transition updates and re-reads all applicable surfaces:

1. the child body;
2. the PR body when a PR exists, or an explicit bound PR-absent state;
3. exactly one existing parent lifecycle entry; and
4. one new parent chronology comment.

The controller first binds the current parent body with a trusted revision identity or body digest and resolves exactly one existing entry for the child. It must reject a missing, duplicate, moved, or ambiguous entry. It then projects the same complete material state to the child body, PR body, unchanged parent row position, and one chronology comment. The parent write is compare-and-preserve: patch only that row under the bound revision, preserve every unrelated entry, existing top-to-bottom order, repository-specific extension, owner-authored content, and completed history, and append exactly one new chronology comment. It must not replace a stale full parent body.

The controller re-reads the four surfaces after the write and verifies the projected fields, row identity, row position, revision, chronology count, and preservation digest. A concurrent change before the write, a concurrent change after the write, a partial write, or any failed post-write read-back is not repaired by blind retry. It enters the exact blocker below and preserves the evidence for controller/user repair. The evaluator and controller derive these results from raw surface projections, revisions, bytes/digests, row positions, chronology records, and preservation snapshots; fixture-supplied `surfacesAgree`, `readBackExact`, or preservation booleans are never authority.

### `PARENT_RECONCILIATION_INCOMPLETE` blocker

`PARENT_RECONCILIATION_INCOMPLETE` applies to missing, duplicate, stale, conflicting, partially written, concurrently changed, or unverifiable parent reconciliation state. While active, it prohibits another worker prompt, auto-code pickup or claim, G4 authorisation, controller acceptance, ready-state mutation, substantive execution, new commits, pushes, external mutation, merge or auto-merge, child closure, next-task selection, verification claims, and programme completion. If the blocker appears after a prompt or lease was issued, active or resumed L1 work stops before further substantive mutation and preserves safe local evidence; the controller must reconcile before continuation. No issued prompt, lease, `GATE_RUNNING`, or downstream result may clear its own blocker.

Keep these gate states distinct and independently evidenced: `GATE_AUTHORISED`, `GATE_RUNNING`, `GATE_RESULT_RECEIVED`, and `CONTROLLER_ACCEPTED`. A prompt may be authorised without running, a run may finish without a result being accepted, and a result may be received without controller acceptance. None of these states proves its own parent reconciliation, review, checks, ledger-independent protocol, merge, or teardown prerequisites.

## 5. Packet-scoped atomic claim

Before substantive L1 launch, the future executor must acquire and verify an atomic packet-scoped, lease-bound create-if-absent claim primitive. The scheduled executor's L0 dispatcher is the sole claimant: it calls `createIfAbsent` once, then reads back the returned record. L1 verifies that existing read-back before substantive work and never calls `createIfAbsent` again. Each capability-owned record is bound to exactly one lease ID and lease expiry, one executor run, one packet, and one observed starting head. GitHub comments, comment IDs, timestamps, lowest-comment-ID rules, or local lock files are audit evidence only and are not mutual exclusion or leases.

The trusted interface is abstract and harness-neutral, but its types are closed and separate:

```text
type ClaimInput = {
  protocolVersion: exact protocol version,
  repositoryIdentity: canonical owner/name and immutable repository id,
  childIdentity: direct child number or immutable id,
  prIdentity: enrolled PR number or immutable id,
  packetId: one packet id,
  executorRunId: one executor run id,
  observedStartingHead: live PR head at claim admission
}

type StoredClaimRecord = {
  ...ClaimInput,
  claimId: capability-issued claim id,
  leaseId: capability-issued lease id,
  leaseExpiresAt: capability-issued lease expiry,
  issuedByCapability: true
}

type CapabilityClaimResult =
  | { created: false, claimId: none, storedRecord: none }
  | { created: true, claimId: capability-issued claim id, storedRecord: StoredClaimRecord }

type ClaimReadBack = {
  claimId: capability-issued claim id,
  exactRecord: StoredClaimRecord or none,
  verified: true or false
}
```

`ClaimInput`, `StoredClaimRecord`, `CapabilityClaimResult`, and `ClaimReadBack` are closed types: unknown or additional fields are rejected. In particular, `ClaimInput` has no `leaseId`, `leaseExpiresAt`, renewal, replacement, retirement, supersession, or authority field. The trusted capability alone creates `claimId`, `leaseId`, `leaseExpiresAt`, and the issued-authority record.

The abstract operations are typed as:

```text
createIfAbsent(input: ClaimInput): CapabilityClaimResult
readBack(claimId): ClaimReadBack
retireOrSupersede(controllerAuthorisedCommand): controller-owned result only
```

The capability rejects caller-supplied lease or authority fields before claim admission and never copies them into a stored record. Such fields cannot mint a lease, replace a lease, renew a lease, validate ownership, or supersede a claim. Only a controller-authorised retirement or supersession command may release an abandoned lease, and only after complete live-state inspection.

`createIfAbsent` must atomically reject a second record for the same repository, child, PR, and Packet ID, and the trusted capability must issue the lease ID and expiry bound to that exact record. A `created: false` result is not a claim for the current run and cannot launch L1. L0 must read back the existing record; L1 then compares every identity, the observed head, and the capability-issued lease before substantive work. A false `verified` result or any read-back identity, head, lease, or expiry mismatch fails the lane closed and requires controller reconciliation. The candidate-controlled packet cannot mint, validate, renew, retire, supersede, or replace the primitive. The claim primitive must not move the implementation PR head. Two successful claims for one packet are impossible by contract.

If the capability is missing, unsupported, non-atomic, unverifiable, or only simulated by comments, the exact result is:

The repository source uses the ASCII spelling `\u2014` for one emitted U+2014 em dash. A runtime result must decode that escape and contain the single em dash; it must not emit a backslash sequence.

```text
BLOCKED \u2014 ATOMIC CLAIM CAPABILITY UNAVAILABLE
```

Lease expiry never grants automatic takeover. Only the web controller may retire or supersede a capability-issued lease, and only after inspecting the live PR head, claim state, GitHub evidence, local worktrees, and possible unpushed executor work. The design PR installs no claim ref, database, workflow, or live claim mechanism.

## 6. Determining the turn

The controller and executor use the following deterministic rules:

| Observed state | Turn/result |
| --- | --- |
| One complete ready controller packet with matching bindings and no matching executor result | Executor turn, subject to atomic claim |
| Matching executor result exists but the controller has not reconciled it | Controller turn |
| No live packet and an actionable child exists | Controller turn |
| Checks are pending after a result or head movement | `WAITING_CHECKS`; no new implementation packet |
| A private user decision or manual schedule action is required | `WAITING_USER` |
| Required worker profile is absent or unavailable | Blocked; exact profile repair is required |
| Duplicate or contradictory authority | Fail the affected lane closed |
| Completed child has no live prompt | No action |

No worker invents the other side's next step. A pending check is not permission to code, a result is not acceptance, and an old G4 is not valid for a new head.

## 7. Model routing and agent hierarchy

Both future scheduled-task templates contain editable Provider, Model, and Reasoning fields for all of these profiles:

1. Scheduled dispatcher.
2. G1/G2 support.
3. Normal G3 implementation/amendment, including a Sol-equivalent.
4. Named G3 escalation, including permitted reasons.
5. Fresh G4.
6. Exceptional final review.

The controller chooses the exact L1 profile in the packet. The scheduled dispatcher cannot substitute a provider, downgrade a model, raise effort, or self-escalate. A required unavailable profile returns a blocked result naming the missing profile; it never silently falls back.

The hierarchy is:

- **L0 - scheduled dispatcher:** validates identity and reconstruction, checks capacity, verifies packet bindings, performs the sole create-if-absent claim and read-back, and launches only. L0 performs no substantive architecture, coding, review adjudication, issue mutation, or grading.
- **L1 - assigned substantive root executor or reviewer:** owns the explicitly assigned implementation or independent review, exact-head checks, focused validation, and evidence packet. L1 follows the Design Lock and cannot broaden it.
- **L2 - direct prompt-bounded helper:** has no carry-over memory, cannot delegate or nest, cannot mutate issues or review state, cannot self-grade, and reports bounded evidence to L1. Unsupported host enforcement is stated as unsupported; Markdown alone is not hard enforcement.

## 8. Redaction, completion, and audit retention

After the receiving side acts and the controller reconciles the result, replace only the transient next-worker payload with:

The repository source uses the same ASCII `\u2014` spelling for the emitted U+2014 marker.

```text
[ REDACTED \u2014 PROCESSED ]
```

Keep the surrounding audit record, including controller summaries, executor evidence, decisions, packet and run IDs, starting and resulting heads, validation, review reconciliation, and durable links. Redaction is visible cleanup, not guaranteed erasure; GitHub edit history, notifications, or integrations may retain the original. Every original packet is therefore public-safe at creation.

Completion is invalid while any live unconsumed next-worker prompt remains. A processed executor evidence packet is never erased just because a controller consumed it.

### Completion and finality gate

Completion eligibility requires all of the following, in a fresh current read:

- every relevant review conversation has been completely swept and `validOpenReviews === 0`;
- required checks are complete and passing, with no pending or unobservable required check;
- the protocol, four-surface reconciliation, and exact-head acceptance are independently verified rather than proved by an evaluation ledger entry alone;
- the controller has reached `CONTROLLER_ACCEPTED`, not merely `GATE_AUTHORISED`, `GATE_RUNNING`, or `GATE_RESULT_RECEIVED`;
- no live final prompt or unprocessed result remains;
- no pending child, user-action, UAT, or other material obligation remains;
- parent, child, and PR material projections agree after the final read-back;
- merge prerequisites are complete and any merge is controller-authorised and exact-head verified; and
- teardown prerequisites are complete, including verified removal of both exact scheduled-task identities with the sole terminal scheduler state `REMOVED`.

There is no live final prompt before completion. `DISABLED`, `PAUSED`, `ACTIVE`, `DUPLICATE`, `AMBIGUOUS`, partially removed, or missing-without-a-trusted-removal-receipt scheduler state is incomplete. The same state cannot prove its own review, check, protocol, acceptance, merge, or teardown gate.

Scheduler finality is identity-bound, not a count of two strings. Each trusted removal receipt must bind the exact repository identity, the exact web-controller task identity, the exact executor task identity, and the required task generation or revision to the observed task record. A receipt for another repository, a receipt with a mismatched identity/generation/revision, or removal of one repository's task cannot satisfy this repository's completion gate; exactly two arbitrary distinct task names are insufficient.

## 9. Public-safe sensitive context

GitHub content may contain secret names, booleans, presence/absence, and privacy-safe verification results. It may contain `[REDACTED]` markers but never values, credentials, authorization headers, environment dumps, private endpoints, or raw connector context. Sensitive executor-only needs use the exact private follow-up section in the ETO grammar. If a raw secret would be needed, stop the affected and dependent lane and report `SECRET_EXPOSURE_DETECTED` without repeating it.

## 10. Adversarial review targets

Every design or G4 review should actively test duplicate execution, stale authority, partial publication, atomic claim correctness, ambiguous adoption, same-PR races, split prompt authority, incomplete review sweeps, redaction lifecycle, secret leakage, scheduler teardown, main movement, forbidden-scope overlap, worktree contamination, possible unpushed work, and profile substitution. A green check or a closed PR is not evidence that any of these obligations disappeared.
