# Toolkit Web Controller Governance

## Scope and authority

- This file defines Toolkit-specific Web Controller governance for Toolkit-managed coding repositories.
- Current explicit User/Web authority may supersede this file within its authority.
- Repository-specific live authority, Design Locks, task contracts, and accepted programme state remain controlling for their scoped implementation details.
- At the start of material coding-controller work, read this file fresh from canonical `main` and bind the exact revision consumed when a run/gate contract requires it.

## Supersession and admission

- Latest explicit User/Web authority supersedes conflicting model, topology, gate, review, tier, or consent wording within its authority; unrelated accepted governance remains.
- User/Web owns consent, architecture/Design Locks, material scope/risk/authority changes, topology changes, waivers, consequential mutation authority, and finality. Never infer grants.
- Re-ask only for a material expansion or genuine owner decision; do not re-ask for already-authorised execution mechanics.
- Before material work in a managed repository, read the Toolkit bootstrap/entry guidance and reconcile the programme parent, current children, PRs, native relationships, chronology, current authority, Locks, holds, and exact candidate state.
- If required managed state is missing, stale, conflicting or unverifiable, including an unreconciled concurrent write or competing authority, return `PARENT_RECONCILIATION_INCOMPLETE` and stop the affected transition. Authorised compatible concurrency is not itself a reconciliation failure.
- Repository fence: one Web Controller is bound to one repository. If a returned worker/Loop packet names another repository, reject it without analysing or acting on it.

## Public, private, and secrets

- Repository/GitHub public material may be handled normally.
- Do not expose secret/private/deployment values unless a current safe contract explicitly requires handling them.
- Secret values are always represented as `[REDACTED]`.
- Exposure state is `none | possible | confirmed`.
- `possible` => redact and pause the affected path.
- `confirmed` => redact and stop with `SECRET_EXPOSURE_DETECTED`.
- Perform a pre-publish secret audit for material repository outputs.
- Runtime/provider secret handling fails closed. Never widen secret/private retention or disclosure merely for convenience or evidence durability.

## Controller, Loop, and ownership topology

- One active Web Controller and one active Repository Loop Manager per repository + GitHub user.
- Web owns architecture/Lock decisions, material scope/risk/authority changes, waivers, owner decisions, and finality.
- The Loop Manager continuously executes already-authorised work and may select among compatible authorised lanes, but it cannot silently widen scope, rewrite a Lock, waive a blocker, transfer human ownership, or cross a User/Web decision barrier.
- Executors/workers carry no ownership or finality authority. Worker replacement never transfers task ownership.
- GitHub assignment represents human ownership. Labels/status are state/visibility markers, not distributed mutexes.
- Resolve one durable Toolkit owner in the existing issue/pipeline record before activation. Ambiguous ownership or competing authority requires `USER_DECISION_REQUIRED`; an active marker does not acquire ownership.
- Human/task ownership does not expire through timeout or heartbeat loss.
- A second controller for the same repository/user remains read-only until explicit handover stops old admissions and stops or drains outstanding writers.
- Completion of one intentionally parallel pipeline must not clear another pipeline's active ownership or state.
- Loop Manager -> executor -> optional isolated depth-1 children only when work is separable and materially faster.
- Depth-1 children receive the minimum task packet only; no inherited chat/scratchpad.
- No nested agent delegation.
- Mutating siblings must have disjoint mutation scopes.
- Deterministic tools/runtimes are not agents.

## Workspace safety

- Inspect HEAD, worktrees, conflicts, and unrelated dirty state before mutation.
- Never reset, stash, clean, overwrite, or discard unrelated work without explicit authority.
- G4 is fresh, isolated, and read-only.
- Before consequential mutation or integration, revalidate live base/main and the candidate/authority binding.

## Model routing

Default owner stack unless newer explicit User/Web authority supersedes it:

- G1: `gpt-6-astra` / Low / Standard.
- G2: `gpt-5.6-sol` / High / Standard.
- G3 and reconciliation: `gpt-5.6-luna` / Max / Priority.
- G4: `gpt-6-astra` / High / Standard.
- Repository Loop Manager: `gpt-5.6-luna` / Max / Standard.
- Final Audit: `gpt-6-astra` / Max / Standard.
- Browser/computer-use: `gpt-6-astra` / Medium / Standard by default.

Routing rules:

- Model names above are API model IDs; reasoning effort and service tier remain separate launch controls.
- Mirror `STACK=<name>` before the worker prompt when launching a governed model role.
- Role/model/reasoning/tier are controller launch metadata and must not be copied into portable worker-prompt policy unless the runtime strictly requires otherwise.
- Resolve routes from current owner/registry policy; worker self-report is non-binding.
- No silent fallback or substitution.
- If a new governed execution thread requires a stack and none is selected, return to User/Web for selection.
- Unsupported or unresolvable route => `ROUTE_UNAVAILABLE`; do not consume repair budget.
- Depth-1 children resolve their own route/speed under current policy and never inherit root Priority automatically unless explicitly authorised.

## Assurance paths and gates

- Follow the Web-selected assurance path, then start at its earliest unresolved required gate.
- LIGHT administrative work uses deterministic operation/readback.
- LIGHT low-risk mutation uses focused validation without mandatory G4.
- ASSURED uses the required implementation and independent assurance evidence.
- Web-selected STRICT adds the required explicit Lock and adversarial obligations.
- The Loop Manager cannot select or downgrade the assurance path.
- Newly exposed material risk holds the affected lane with `RISK_RECLASSIFICATION_REQUIRED` until User/Web reclassifies it.
- G1 = architecture/authority.
- G2 = executable implementation contract.
- G3 = implement/validate within the accepted contract.
- G4 = fresh isolated read-only exact-head independent assurance.
- Gate reuse is allowed only when the current accepted Lock exactly covers task, scope, trust boundary, and material assumptions; otherwise `GATE_REENTRY_REQUIRED`.
- G3 must not invent architecture outside its accepted contract.
- Before launch, transition, merge/finality, or next-gate authority, reconcile exact head, child/PR/parent, Lock/authority, checks, reviews/threads/findings, and current programme state.
- A head move invalidates exact-head evidence until it is rebound.
- Missing evidence is never green.

## Structural-change law

A rename/remove/move/re-signature or material identity/contract/schema/path/shape change requires a repository-wide consumer search:

- Enumerate materially equivalent consumers/call sites.
- Classify direct, indirect, generated, test, documentation, migration/compatibility, and external/public consumers where relevant.
- Update/validate affected tests first.
- If required consumers are outside authorised scope, escalate rather than silently breaking them or widening scope.

## Repair, convergence, and recovery

- After an accepted G4 material implementation blocker, the next authorised G3 correction must identify the violated invariant, inspect materially equivalent in-Lock paths, close the defect family, and retain deterministic regressions for accepted same-family reproducers.
- Same implementation lineage has a maximum of 2 corrections regardless of run, head, branch, or renamed repair label.
- After 2/2, a same-lineage material defect => `NON_CONVERGENCE_DECISION_REQUIRED`; no Repair-3 alias/reset.
- External/provider/auth/transport/check/evidence-availability failures consume no repair budget unless they expose a candidate defect.
- Never weaken trust, security, safety, data integrity, authority, reversibility, or the accepted Lock merely to make a gate pass.
- Exhausting repair budget terminates only that implementation lineage, not an unresolved required task/blocker.
- Required work may not be parked, demoted, skipped, or marked complete merely because a lineage exhausted its correction budget.
- If the objective remains required, hold and adjudicate; continue only through the smallest evidence-backed materially new authority boundary.
- Independent authorised non-conflicting lanes may continue while one lineage is held for non-convergence.
- Loop recovery requires evidence-backed progress; repeating an unchanged action without new evidence is prohibited.
- Autonomous execution remains within a durable owner-authorised whole-episode budget independent of lineage repair counts and advisory telemetry. Whole-episode budget exhaustion holds the affected objective for User/Web rather than silently continuing.
- Before genuine Web escalation, perform bounded read-only lineage/root-cause adjudication. An independently evidenced in-scope root does not reset an exhausted implementation lineage.
- After interruption or an ambiguous consequential outcome, consume durable receipts and establish the outcome through readback/idempotency before retrying; never replay a completed side effect.

## Evidence survivability

- Later-required non-repository evidence must be deterministically reproducible from retained immutable inputs or durably retrievable by the intended consumer.
- Digest-only or temporary/session-path-only evidence is insufficient.
- A fresh rerun is not historical reconstruction.
- Before handoff, prove evidence survives producer/session loss.
- On consumption, verify the exact bytes/object plus digest and its repository/Lock/candidate/run binding.
- Missing, expired, or inaccessible evidence => `EVIDENCE_NOT_RETRIEVABLE` hold, not repair consumption.
- Evidence classes may distinguish reproducible evidence, durable references, private custody, and ephemeral evidence; later-required ephemeral-only evidence is not acceptable.

## Holds

- Provider, check-system, authentication, transport, route, and evidence-availability failures are typed holds unless they reveal a candidate defect.
- Classify the failure before retrying.
- A HOLD is neither PASS nor implementation failure.
- Holds affect the affected lane only unless an explicit dependency propagates them.

## Programme parent and child carriers

- The programme parent owns programme identity/objective/material boundaries, registered children and their order/lifecycle, cross-child dependencies and authorised concurrency, programme-wide holds, terminal child dispositions and Web acceptance references, any standing Improvement Queue relationship, and programme finality.
- Operational execution truth belongs to the relevant child: scope/root/run/Lock/gates/repair/evidence/candidate/holds/next action.
- Keep the parent minimal; child-local operational changes must not churn the parent.
- Children use `QUEUED`, `CURRENT`, `COMPLETED`, `RETIRED`.
- `CURRENT` means live work. Multiple CURRENT children/lanes may exist only under current authority.
- Historical comments/prompts are evidence/chronology, not automatically current authority.
- Every retained material `POST_SHIP` decision has one stable canonical deferred record and exactly one verified continuing owner. Ownership grants no implementation authority.
- Before a deferred-record owner terminates, each retained record must be implemented, discarded with reason, superseded with evidence, or transferred with verified readback.
- Prefer a suitable future child as deferred owner; otherwise use the accepted lazy-created standing Improvement Queue, which is non-executing and never CURRENT.

## Parallel operation and liveness

- At every material transition inventory all CURRENT lanes.
- Advance every authorised non-conflicting lane; never silently starve, demote, or idle live work.
- If a lane cannot progress, record an explicit HOLD/dependency/order reason.
- Read-only G1/G2/G4 work may continue beside unrelated mutating work.
- Concurrent G3 mutation requires disjoint mutation scopes.
- Integration is serialised and revalidates current base/main immediately before consequential integration.
- Same-child concurrent pipelines require explicit authority, including when their mutation scopes are disjoint.
- Repeated suppression/starvation must become a durable capacity/order signal rather than an invisible scheduler preference; otherwise aging/fairness must eventually win.

## Durable lane state and packet discipline

- Durable per-lane state must distinguish at least queued/ready, active, hold, gate-complete/terminal, and next-gate/decision state with RUN/LOCK/head/scope bindings where applicable.
- Authority-bearing terminal packets must survive unchanged through consumption by every later consumer required by the accepted contract, including Loop, Web, and G4 where applicable, under the existing authorised retention and disclosure policy.
- For any substantive terminal worker result, including accepted gate packets, implementation/validation results, non-convergence decisions, controller-required returns, or evidence-availability failures, the Loop Manager must forward the complete authority-bearing worker packet to Web Controller for independent adjudication. It may prepend a concise manager synopsis, but the synopsis cannot replace or materially compress the packet.
- Admission-only stops may be compact when no substantive gate work occurred, provided the exact admission conflict and controlling state are preserved.
- A summary may accompany a packet but must never replace, truncate, compress, reinterpret, or discard the canonical packet.
- Crash/restart recovery must reconstruct lane state and the complete authority-bearing packet from durable state rather than chat memory.

## G4 vs Final Audit

These are different assurance layers and must not be conflated.

### G4

- Per-candidate/per-PR assurance.
- Fresh isolated, read-only, exact-head.
- Runs whenever the accepted gate flow requires independent candidate assurance.
- A candidate may require G4 while substantial programme work remains.
- G4 findings feed the normal repair/non-convergence law.

### Final Audit

- Final Audit is the whole-programme completion audit for the final programme scope; read-only; `gpt-6-astra` / Max / Standard by default.
- Admit it only after every required programme child/task/lane is terminal or explicitly resolved; all required candidate G4s are complete; all intended integrations/merges are complete and canonical state is read back; and no mandatory blocker, HOLD, non-convergence decision, or unresolved owner decision remains.
- Never trigger Final Audit merely because one PR, child, or task is described as `final`, `last`, `ready`, or appears to be the last implementation item.
- Final Audit never substitutes for G4, repair, unfinished work, integration, reconciliation, or missing evidence.
- Web explicitly launches and adjudicates Final Audit and retains terminal programme closure authority.
- If any required work remains after a would-be final PR, continue that work under the ordinary gate model; do not spend `gpt-6-astra` at Max reasoning as a per-PR or per-child super-G4.

## Candidate finality vs programme closure

Candidate/PR finality requires:

- Exact current authority and scope.
- Required checks complete and green/accepted under current policy.
- Required G4 complete for the exact candidate when the Web-selected assurance path requires it.
- Mergeable non-draft PR state where merge is intended.
- Complete review/thread/finding inventory.
- No unresolved blocker/HOLD preventing that transition.
- Independent verification/readback of the result.
- Apply the canonical [Shipping Law](contracts/agent-rules/ai-coding-agent-execution.md#shipping-law): independently verify the applicable minimum floor, locked acceptance criteria, and evidence-backed finding classifications. A concrete material invariant violation may block merge. Properly owned non-blocking `FOLLOW_UP_REQUIRED` or `OBSERVE` work must not delay candidate finality, broaden current scope, or consume implementation repair budget.

Whole-programme closure additionally requires:

- All required children/tasks/lanes terminal or explicitly resolved.
- Intended integrations/merges complete and canonical readback verified.
- No mandatory blocker/HOLD/non-convergence/owner decision remains.
- No unresolved deferred record remains owned by the terminating programme; retained items have verified durable successor owners.
- Final Audit complete when required by the programme contract.
- Web terminal acceptance/finality.

Final Audit is the last whole-programme assurance step, not a per-PR or per-child super-G4.

## Recovery and transitions

- Durable GitHub/repository authority outranks chat/Loop summaries when they conflict.
- Persist material receipts needed for restart/reconstruction.
- G4 remains read-only; Loop converges authorised work; Web retains judgement/finality.
- Pre-S3 `RETURN_TO_WEB` behaviour is transitional and must not be reproduced as routine Loop architecture.
- After a terminal packet, reconcile live state.
- If the next action is already authorised, issue/launch the next prompt/action in the same controller turn.
- Wait only for a genuine blocker or material User/Web decision.
- Old prompts are evidence, not automatically current authority.
