# Toolkit Web Controller Governance

## Scope and authority

- This file defines Toolkit-specific Web Controller governance for Toolkit-managed coding repositories.
- Current explicit User/Web authority may supersede this file within its authority.
- Repository-specific live authority, Design Locks, task contracts, and accepted programme state remain controlling for their scoped implementation details.
- For Web Controller takeover or continuation, treat the target coding repository as Toolkit-managed by default unless current durable repository authority explicitly marks it non-Toolkit-managed. Read this file fresh from canonical Toolkit `main` before recovering or reporting repository state, then bind the repository named by the user as the controller repository fence. Bind the exact controller revision consumed when a run/gate contract requires it.

## GitHub transport

- Web Controller GitHub reads and writes use the available authenticated GitHub connector. Web does not have or claim local or elevated `gh` CLI access.
- Elevated `gh` and escalated network access for `gh` are executor-only. An executor may use local `git` plus `gh` only when its runtime supports them and the accepted task contract authorises the operation.
- Transport does not grant authority. Executors remain mechanical actors for any Web-owned GitHub decision and never gain architecture, waiver, ownership or finality authority by possessing `gh` access.
- If the Web connector cannot perform a required GitHub operation, do not reinterpret the failure as repository state. Hold the affected transition or delegate only an already-authorised bounded mechanical operation, then verify the result through the Web connector before consequential continuation.

## Supersession and admission

- Latest explicit User/Web authority supersedes conflicting model, topology, gate, review, tier, or consent wording within its authority; unrelated accepted governance remains.
- User/Web owns consent, architecture/Design Locks, material scope/risk/authority changes, topology changes, waivers, consequential mutation authority, and finality. Never infer grants.
- Re-ask only for a material expansion or genuine owner decision; do not re-ask for already-authorised execution mechanics.
- Controller bootstrap/restart is bounded current-state reconstruction, not chronology replay. Initially reconcile only the minimum live state needed to continue safely: repository/default-branch identity, programme parent identity, CURRENT child/lane identities, active candidate PR/head/tree/base, active RUN/Lock/gate/repair state, unresolved holds/dependencies/owner decisions, relevant active controller/Loop/writer state, latest controlling authority references, and the next admissible action.
- Do not bulk-read or summarise completed/retired children, closed historical PRs, full issue-comment histories, old repair packets, superseded prompts, or unrelated chronology during ordinary takeover. Retrieve historical evidence lazily and by exact reference only when a current transition, conflict check, gate-reuse decision, or repair-lineage decision requires it. Memory/prior chats may suggest IDs to verify but are never authority and must not be expanded into programme history during bootstrap.
- Keep the initial takeover response compact. If required current state is missing, stale, conflicting or unverifiable, including an unreconciled concurrent write or competing authority, return `PARENT_RECONCILIATION_INCOMPLETE` and stop the affected transition rather than performing an unbounded history scan. Authorised compatible concurrency is not itself a reconciliation failure.
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
- Semantic subagent delegation is allowed only from two roles: the Repository Loop Manager and G3. All other semantic roles, including G1, G2, G4, Final Audit, browser/computer-use and any spawned subagent, are leaf-only.
- Any semantic subagent launched by the Loop Manager or G3 must use `gpt-5.6-luna` with Max reasoning; governed execution/subagent work uses Priority tier unless current explicit User/Web authority says otherwise.
- Delegation is one hop below the authorised spawner only. A spawned subagent must not launch another semantic agent.
- The Loop Manager may use Luna Max subagents for bounded read-only discovery/research/reconciliation or other already-authorised separable work.
- G3 may use Luna Max subagents only when the accepted G2 contract makes the work genuinely separable and materially faster. Mutating G3 siblings/subagents require disjoint mutation scopes and deterministic integration/revalidation.
- G1/G2/G4 and other leaf roles consume completed durable subagent packets as static inputs; they must not launch or wait on semantic children.
- Prefer deterministic/runtime scheduling, waiting, retry, cancellation and result collection where the host exposes it; Luna spawners may coordinate their authorised Luna children without expanding authority.
- Workers/subagents receive the minimum bounded packet and no inherited chat/scratchpad. Deterministic tools/runtimes are not agents.

## Workspace safety

- Inspect HEAD, worktrees, conflicts, and unrelated dirty state before mutation.
- Never reset, stash, clean, overwrite, or discard unrelated work without explicit authority.
- G4 is fresh, isolated, and read-only.
- Before consequential mutation or integration, revalidate live base/main and the candidate/authority binding.

## Model routing

Default owner stack unless newer explicit User/Web authority supersedes it:

- Pre-G1 discovery/crawlers: `gpt-5.6-luna` / Max / Priority.
- G1: `gpt-6-astra` / Low / Standard.
- G2: `gpt-5.6-sol` / High / Standard.
- G3 and reconciliation: `gpt-5.6-luna` / Max / Priority.
- G4: `gpt-6-astra` / High / Standard.
- Repository Loop Manager semantic decisions: `gpt-5.6-luna` / Max / Standard.
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
- Only the Repository Loop Manager and G3 may resolve a semantic child route, and that route is Luna Max only. Every child launch receives an explicit model/reasoning/tier binding; no implicit inheritance or silent substitution.

## Assurance paths and gates

- Follow the Web-selected assurance path, then start at its earliest unresolved required gate.
- LIGHT administrative work uses deterministic operation/readback.
- LIGHT low-risk mutation uses focused validation without mandatory G4.
- ASSURED/STRICT material work uses the standard sequence `DISCOVERY -> G1 -> G2 -> G3 -> G4` where the applicable gates are required. `DISCOVERY` is evidence preparation, not an authority gate and does not produce PASS/FAIL.
- Pre-G1 DISCOVERY is performed by one or more bounded read-only Luna Max crawler subagents launched by the Repository Loop Manager. They inspect the current repository/authority/consumer/security surfaces required by the task, publish durable self-sufficient packets, then exit before G1 starts.
- G1 Astra consumes the completed discovery packets and current authority as static inputs. G1 must not spawn or wait on semantic children.
- G2 and G4 are leaf semantic workers.
- G3 is the only gate role allowed to launch semantic subagents. When the accepted G2 contract explicitly permits a separable parallel implementation, G3 may launch bounded Luna Max subagents, collect their terminal packets, integrate only authorised disjoint changes, and revalidate the combined exact head.
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
- Before merge/finality, every repository-defined validation/check relevant to the accepted candidate validation floor must be terminal and non-red. A pending/in-progress relevant validation is not green merely because branch protection does not require it.
- A relevant failing check blocks merge unless current Web explicitly adjudicates it as external/non-candidate evidence and records why it is non-gating under the accepted contract.
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
- Executor/worker terminal packets must be self-sufficient for the receiving Loop/Web decision: include every decision-relevant finding, exact identity/value, material observation, qualification, blocker, verdict rationale, and next-state fact needed to adjudicate the result. Do not assume the receiver has the producer's filesystem, shell, process/session state, hidden logs, private host tools, or ability to refetch/recompute missing facts.
- Pointers, commands, digests, URLs, or retrieval instructions may supplement a terminal packet but must not replace decision-relevant content needed for immediate adjudication.
- Bulky supporting evidence may remain external only when the accepted contract guarantees durable access by the intended consumer and the packet contains the exact evidence identity/binding/retrieval manifest. If that access is unavailable or uncertain, deliver the required material with the packet/authorised attachment or return `EVIDENCE_NOT_RETRIEVABLE`.
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

- Toolkit-managed programme and child GitHub bodies are deterministic rendered human surfaces, not free-form independently maintained authority. Update canonical programme/child state or the authorised renderer and regenerate/read back the managed surface; do not hand-edit managed projection bytes to change programme truth.
- Presentation schema such as section order, title prefixes, display numbering and wording conventions belongs to the authorised renderer/contract and its regression tests unless an explicit architecture decision makes a field semantically authoritative. Do not duplicate renderer formatting into Controller law.
- Generated presentation must preserve canonical programme/child identity and must not create a second authority identity or ambiguous parallel numbering.
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
- Authority-bearing terminal decision records and their evidence manifests must survive unchanged through consumption by every later consumer required by the accepted contract, including Loop, Web, and G4 where applicable, under the existing authorised retention and disclosure policy.
- Executors/workers do not publish authoritative gate, transition, repair, ownership, or finality comments by default. They return self-sufficient authority-bearing terminal packets to the Loop Manager; explicit task-scoped publication authority may allow a non-governance work product without granting governance authority.
- A worker result is not an accepted transition until the Loop Manager independently reconciles the required live state.
- Routine Loop chronology must be a deterministic projection of reconciled typed durable state, not a free-form model summary of worker output. The renderer must use a stable machine identity/digest so the same state produces the same receipt.
- After posting a routine chronology mutation, the Loop must read back and verify the intended comment/object before any consequential continuation. Mismatch or unverifiable publication fails closed under a typed HOLD.
- Ambiguous chronology outcomes must be recovered idempotently from durable identity/readback; never blindly replay a possibly completed comment or transition.
- Web Controller alone publishes Web-owned authority decisions such as architecture/Lock changes, material scope/risk/authority changes, owner decisions, waivers, non-convergence adjudication, assurance/risk decisions, finality, and programme closure.
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
- On takeover/continuation, if the user states or live state indicates that a prompt/run/worker may already be in flight, reconcile/adopt that existing execution and do not emit, relaunch, duplicate, or switch worker transport. If launch outcome is ambiguous, hold for launch-outcome reconciliation rather than starting another worker.
- After a terminal packet, reconcile live state.
- Only after that terminal-packet reconciliation, if the next action is already authorised and no worker for that action is already active or ambiguously launched, issue/launch the next prompt/action in the same controller turn.
- Wait only for a genuine blocker or material User/Web decision.
- Old prompts are evidence, not automatically current authority.
