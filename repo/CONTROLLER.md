# Toolkit Web Controller Governance

## Scope and authority

- This file defines Toolkit-specific Web Controller governance for Toolkit-managed coding repositories.
- Current explicit User/Web authority may supersede this file within its authority.
- Repository-specific live authority, Design Locks, task contracts, and accepted programme state remain controlling for their scoped implementation details.
- Treat the target coding repository as Toolkit-managed by default unless current durable repository authority explicitly marks it non-Toolkit-managed. Bootstrap/takeover/restart and Controller revision refresh follow the bounded policy below; bind the repository named by the user as the controller repository fence.

## GitHub transport

- Web Controller GitHub reads and writes use the available authenticated GitHub connector. Web does not have or claim local or elevated `gh` CLI access.
- Elevated `gh` and escalated network access for `gh` are executor-only. An executor may use local `git` plus `gh` only when its runtime supports them and the accepted task contract authorises the operation.
- Transport does not grant authority. Executors remain mechanical actors for any Web-owned GitHub decision and never gain architecture, waiver, ownership or finality authority by possessing `gh` access.
- If the Web connector cannot perform a required GitHub operation, do not reinterpret the failure as repository state. Hold the affected transition or delegate only an already-authorised bounded mechanical operation, then verify the result through the Web connector before consequential continuation.

## Controller bootstrap and refresh

- On a new Web Controller bootstrap, takeover, explicit handover, restart after lost controller state, or new chat that must reconstruct control, read `repo/CONTROLLER.md` fresh from canonical Toolkit `main` and bind the exact Controller revision plus repository fence before material continuation.
- During the same live controller session, keep using the bound Controller revision. Do not re-read the full Controller merely because a worker/Loop packet returns, CI changes, a GitHub comment is posted, or ordinary continuation occurs.
- Before a new material worker/stage launch or another consequential authority/finality transition after the current action has terminally reconciled, perform a lightweight canonical Controller revision check. Prefer commit/blob/digest identity that does not load the full Controller bytes into model-visible context.
- If the canonical Controller identity is unchanged, continue from the bound revision without a full re-read. If it changed, read the new Controller once, reconcile the material impact, and bind the new revision before the next material launch/transition.
- An in-flight run remains governed by the exact Controller/Lock revision it was admitted under; a later Controller revision does not silently rewrite an active worker contract. Apply newer law at the next safe reconciliation boundary unless current explicit User/Web authority requires an immediate hold or re-entry.
- A packet that claims a newer/unknown Controller revision, a governance conflict, missing binding, or unverifiable Controller identity requires fresh Controller read/reconciliation before consequential continuation.
## Takeover I/O discipline

- Ordinary Web takeover/restart uses narrow-to-deep retrieval. Start with Controller identity/revision, repository/default-branch/main identity, programme parent CURRENT projection, CURRENT child/lane projections, active candidate lightweight metadata, exact-head checks, review/thread/finding summary, and only exact controlling receipt pointers that are materially required.
- A bootstrap PR lookup should expose only decision-relevant metadata such as number/state/draft/head/base/mergeability unless the current decision requires more. Do not place a connector's full PR object, body, diff, patch or unrelated ancillary fields into model-visible context merely because the API returned them.
- Do not enumerate full issue/PR comment history, workflow logs/artifacts, completed children, closed historical PRs or superseded repair packets during ordinary bootstrap unless a specific unresolved fact requires that evidence.
- Connector/API response size and model-visible context are separate concerns. Tool orchestration must project large responses to the minimum sufficient decision fields before they enter normal model-visible context whenever the tool/runtime permits shaping or filtering.
- Progressive disclosure is mandatory: PR state -> lightweight metadata; changed scope -> filenames; implementation detail -> exact relevant patch/file; CI state -> run/job summary; failure cause -> relevant failed job/step; historical authority -> exact referenced receipt.
- If a bootstrap retrieval unexpectedly returns materially broader/large payload than the current decision requires, do not continue expanding from it. Treat that as a bootstrap-context guard signal, discard/avoid further use where possible, retry with a narrower operation/projection, and record a HOLD only if minimum-sufficient evidence cannot be obtained safely. Do not weaken evidence requirements merely to stay small.
- Historical chronology remains available lazily by exact reference. Ordinary takeover must not infer current authority by scanning chronology when the owned CURRENT projection or its controlling pointer should provide that fact.

## CURRENT operational completeness

- CURRENT must be sufficient to safely generate the current or next admissible actionable prompt. Any **material live operational identity** that the action will name, select, address or mutate must be present in CURRENT or be deterministically derivable from another CURRENT authoritative field.
- Material live operational identity is repository-specific and action-specific. Examples may include environment, public host/origin, callback URI, deployment target/application/resource, provider project, database/storage target, branch-to-environment mapping, region, externally visible endpoint, or equivalent mutable live-resource binding. Do not hard-code a global field list or project every configuration value.
- Before Web or Loop emits a live-operation prompt, perform a bounded material-field admission check: identify the external/repository identities the action will touch; confirm they are present/derivable in CURRENT; check for conflict with newer explicit Owner/Web authority; and obtain a fresh authoritative provider/repository read when the accepted operation requires drift-sensitive live verification.
- If a required material identity is missing, stale, contradictory or unverifiable, return `CURRENT_PROJECTION_INCOMPLETE` and reconcile CURRENT before issuing the actionable prompt. Never fill the gap from historical comments, completed issues, old receipts, examples, fixtures, cached controller context, prior worker packets or memory.
- Reconciliation is semantic and field-level, not "latest comment wins". For a live operational field, authority precedence is: latest explicit Owner/Web authority -> CURRENT authoritative projection -> exact controlling receipt referenced by CURRENT -> fresh authoritative provider/repository read where required -> historical evidence for investigation only. A newer historical/reporting receipt does not supersede a field unless it carried authority to change that field.
- CURRENT should retain only the bounded live identities material to the active lane, together with enough field-level authority/provenance to disambiguate current truth. Secrets remain names only; values are `[REDACTED]`.
- When an accepted action changes a material operational identity, progression must not continue until the owned CURRENT projection is updated and read back with the resulting accepted identity. The worker/operation receipt preserves history but does not substitute for CURRENT reconciliation.
- Takeover/restart reads CURRENT first, performs only cheap authoritative checks needed for the next action, reconciles stale/missing material fields, and expands into chronology only for a concrete unresolved contradiction. Receipts preserve history; CURRENT defines what is true now for operational continuation.

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
- **Delivery Child lifecycle law:** an admitted Delivery Child is a durable programme ownership boundary. Ordinary worker failure, gate HOLD, G4 AMEND, implementation non-convergence, exhausted correction budget, route/provider/evidence HOLD, Loop pause, or executor replacement does **not** by itself close, retire, supersede, replace, or transfer that child.
- A Delivery Child may be closed as completed only after its required acceptance/finality is actually achieved and the terminal disposition is durably recorded. A still-required child may be superseded or retired only by an explicit current Owner/Web decision that names that lifecycle disposition and preserves/transfers every remaining mandatory obligation to a durable continuing owner. Do not infer supersession from repair exhaustion or create a replacement child merely to obtain a fresh correction budget.
- Exhaustion of an implementation-lineage correction budget places the existing child in a non-convergence/Owner-Web adjudication state. It does not manufacture Repair 3, a fresh budget, or a new Delivery Child. A later implementation lineage or child boundary requires a separately justified architecture/authority decision; renaming or recreating containers is never sufficient. After exhaustion, Owner/Web may explicitly reserve at most one `RECONVERGED_CORRECTION` for the same continuing scope only when fresh root synthesis explains why earlier corrections missed the accepted invariant, fresh G2 adversarial closure is required before mutation, the exhausted `2/2` history remains visible, and the exceptional episode has a fixed scope, one submitted G4 candidate, unchanged assurance, and no automatic follow-on repair. A material rejection of that exceptional candidate ends autonomous same-scope correction.
- After autonomous same-scope correction is exhausted, the unresolved required child returns to Owner/Web. Owner/Web may explicitly grant a `WEB_DIRECTED_CONTINUATION` for that same continuing child and scope when a fresh accepted G2 contract deterministically binds the remaining implementation, exact mutation/candidate boundary, validation and assurance obligations. This is not Repair 3, not a new implementation lineage, not a fresh correction budget and not a replacement child. The historical `2/2_EXHAUSTED` and any consumed reconverged exception remain visible. Each grant authorises at most one bounded implementation candidate plus its required fresh G4; any material G4 result returns to Owner/Web and grants no automatic follow-on continuation.
- **Loop executor anti-bounce is not child lifecycle:** bounded diagnosis/recovery applies inside the existing child, but the Loop does not automatically spend a higher-model `RECONVERGENCE` call merely to avoid returning to Web. After one focused diagnosis/recovery, a repeated same/root-related HOLD returns to Owner/Web with the bounded evidence. Web may optionally invoke one read-only `RECONVERGENCE` synthesis when that diagnostic is materially useful. Re-convergence may identify the smallest G2/G1/Owner boundary or confirm an already-authorised continuation, but it cannot grant authority, reset budgets or change child lifecycle.
- Semantic delegation authority is stage-based, not model-based.
- `G0-B` and `G3` are the only subagent-capable stages/roles.
- `G0-A` is leaf-only problem framing. `G0-B` is Loop-owned evidence acquisition and may fan out bounded depth-1 read-only discovery subagents only when the split is genuinely separable and useful.
- `G3` may fan out bounded depth-1 subagents only inside the accepted G2 contract. Mutating G3 subagents require disjoint mutation scopes and deterministic integration/revalidation.
- All other semantic stages/roles are leaf-only, including G0-A, G1, G2, G4, RECONVERGENCE, Final Audit, Browser/computer-use, and every spawned subagent.
- Delegation depth is one. A spawned subagent must not launch another semantic agent.
- Concrete parent/child provider/model/reasoning bindings come from the explicitly selected stack registry; service treatment is non-authoritative and model identity never grants delegation authority by itself.
- Workers/subagents receive the minimum bounded packet and no inherited chat/scratchpad. Deterministic tools/runtimes are not agents.

## Workspace safety

- Inspect HEAD, worktrees, conflicts, and unrelated dirty state before mutation.
- Never reset, stash, clean, overwrite, or discard unrelated work without explicit authority.
- G4 is fresh, isolated, and read-only.
- Before consequential mutation or integration, revalidate live base/main and the candidate/authority binding.

## Stage and stack routing

- Governance refers to symbolic execution stages/roles, not concrete model families: `G0-A`, `G0-B`, `G1`, `G2`, `G3`, `G4`, `LOOP`, `RECONVERGENCE`, `FINAL_AUDIT`, and `BROWSER`. `G0-A` and `G0-B` are phases of one non-gating G0 stage.
- Concrete provider/model/reasoning choices live in the cold stack registry at `repo/contracts/controller-kernel/stack-registry-v2.json` in canonical Toolkit; they are configuration, not Controller law. Service treatment/speed is non-authoritative observed metadata only and is not part of an authoritative route binding.
- Every execution thread must bind an explicit named registered stack from the bound canonical Toolkit revision. There is no default stack and no silent fallback.
- Stack selection is an explicit User/Web execution decision and is independent of the physical harness. A harness may expose several providers/models, but it must not choose or rewrite the stack merely because a route is locally available.
- Before launch, resolve the requested stage/role against that explicitly selected stack and place the stack ID, exact stack-registry revision/digest, and resolved provider/model/reasoning route in the launch packet for the human/launcher to configure.
- Every Toolkit-managed launch packet must also bind the canonical Toolkit governance source: canonical repository `weijunswj/ai-agent-toolkit`, exact remote canonical-`main` commit, Controller blob, and stack-registry blob. Consume an already-bound CURRENT/Web receipt when available; do not rediscover these identities from a local Toolkit checkout.
- A local Toolkit repository, local `HEAD`, local branch/ref, working tree, or filesystem path is never governance authority. Local Git objects may be used only as a byte cache after the exact canonical remote commit/blob identities are already bound; read those exact objects by identity. If a required refresh is needed, establish it from canonical GitHub `main` first. Local divergence, dirtiness, branch selection, or stale refs must not change routing/governance truth.
- The trusted route binding is established before execution by the human or deterministic launcher selecting/configuring the requested route in the harness. For interactive desktop harnesses, launching the session after that selection is the route-binding act.
- The executor/LLM must never inspect, prove, attest, infer, reject, or block on its own provider/model/reasoning identity. Missing runtime model metadata is never a HOLD and never causes `HARNESS_HANDOFF_REQUIRED`.
- If the human/launcher cannot select the required registered route, do not launch that worker. User/Web may select another registered stack/harness or explicitly change the route. This is a pre-launch orchestration decision, not a worker self-attestation decision.
- Silent route/model fallback or substitution remains prohibited. Where independent launcher/harness metadata visibly establishes a contradiction, treat that as orchestration evidence and fail closed; do not ask the worker to self-verify.
- Bind each concurrently launched session/worker to its declared route before launch. Parallel lanes may use separate harness sessions; post-launch worker introspection is never part of parallelism admission.
- Only `G0-B` and `G3` may resolve semantic subagent routes. All other stages/roles are leaf-only. Subagent prompts name the semantic role/capability, not a concrete model. A subagent uses the route that the human/launcher bound for that child, or inherits the already-bound parent route where the harness supports inheritance; the subagent itself does not verify the route.
- Parallel semantic fan-out is optional. If the required route cannot be selected/configured for a child, use a separately bound compatible session/harness or run serially when the accepted contract permits it; never silently substitute another route or transport.
- Current explicit User/Web authority may select another registered stack for a run. Changing only stack bindings does not change stage semantics or grant new topology authority.
- Authoritative semantic prompts remain portable and stage-oriented and do not hard-code concrete provider/model/reasoning names. The launch packet may display the resolved concrete route for human/launcher configuration, but prompt wording never grants route or model authority.

## Assurance paths and gates

- Follow the Web-selected assurance path, then start at its earliest unresolved required gate.
- LIGHT administrative work uses deterministic operation/readback.
- LIGHT low-risk mutation uses focused validation without mandatory G4.
- ASSURED/STRICT material work uses the standard chronology `G0-A -> G0-B -> G1 -> G2 -> G3 -> G4` where applicable. `G0-A` and `G0-B` are phases of one non-gating G0 stage, not additional approval gates.
- `G0-A` = bounded problem framing. For uncertain, diagnostic, security- or authority-sensitive work it identifies known facts, contradictions, material unknowns, competing hypotheses, discriminating evidence questions and a stopping condition for sufficient evidence. It is leaf-only and read-only. For genuinely simple/well-specified work a separate G0-A model invocation may be omitted or compacted.
- `G0-B` = bounded evidence acquisition. For material discovery it consumes a compact `toolkit.evidence-manifest.v1` whose question IDs, target surfaces, evidence macros, provenance requirements and stop conditions are semantic inputs. `repo/scripts/toolkit-evidence-plan-compiler.cjs` deterministically expands that manifest into leaf-ready read-only packets and merge requirements. G0-B/subagents may follow evidence only inside the named question/surface boundary and may not invent a new architecture question, implementation task or authority. Depth-1 fan-out remains optional and only for genuinely separable questions.
- G1 = root convergence plus architecture/authority. For material uncertain work, G1 PASS requires a supported bounded causal model, material competing hypotheses and their disposition, governing invariant/trust ordering, materially equivalent surfaces, smallest coherent boundary, and explicit remaining assumptions. Material unresolved root uncertainty => HOLD with a specific missing-evidence request.
- G2 = adversarial executable-contract closure. A fresh G2 must be able to inspect primary sources and challenge G1. For material implementation work, G2 records semantic decisions in compact `toolkit.gate-contract-ir.v1`: governing invariants, materially equivalent surfaces, allowed/forbidden behaviour, selected reusable adversarial macros, explicit exceptions, mutation allowlist, validation and evidence requirements. `repo/scripts/toolkit-gate-contract-compiler.cjs` deterministically expands that IR into the concrete G3 execution packet and adversarial oracle matrix. G2 spends model reasoning on semantic closure rather than hand-writing repetitive permutations. A missing material decision is `G2_CONTRACT_INCOMPLETE`, never an invitation for G3 to guess.
- For expressly low-uncertainty/simple work, one invocation may establish logically separate G1 and G2 decisions when current routing/authority allows it; record that no fresh independent-model challenge occurred. Difficult/diagnostic/security/authority-sensitive work uses a fresh G2 context.
- G3 = literal implementation/validation of the compiled G2 execution packet. G3 has zero authority to infer missing compatibility, aliases, fallback behaviour, equivalent surfaces or adversarial cases. It must materialize/run every generated oracle, stay inside the exact mutation allowlist, demonstrate baseline witness or pre-existing coverage where required, then run the required existing validation. If the compiled packet lacks a material decision, return `G2_CONTRACT_INCOMPLETE`; if satisfying it requires out-of-scope mutation, return `G3_CONTRACT_BLOCK`. G3 still demonstrates closure at actual consequential/public boundaries, not merely helper-level tests.
- The Gate Contract IR is validated before canonicalization and its compiler emits post-expansion assertions, deterministic requirement/surface coverage, and collision-safe oracle IDs. Empty expectations, zero-expansion macros, uncovered surfaces and unbound exclusions fail closed. The G0-B Evidence Manifest compiler binds every packet to source, question, packet and plan digests; evidence responses require exact applicability/provenance identity and independent parent review. Leaf claims never promote incomplete or unverifiable evidence to `COMPLETE`.
- G4 = fresh isolated read-only exact-head independent assurance of the complete candidate. Do not weaken G4 to improve pass rates.
- Material G4 findings should carry one primary diagnostic classification when supported: `G1_ROOT_MODEL_MISS`, `G2_CONTRACT_COVERAGE_MISS`, `G3_IMPLEMENTATION_MISS`, or `G4_NOVEL_EDGE_CASE`. Classification is learning evidence, not a score or authority grant.
- `RECONVERGENCE` is a read-only leaf role, not a gate and not an automatic Loop escalation. After bounded focused diagnosis/recovery, the Loop returns material ambiguity/non-convergence to Web. Web may invoke Re-convergence when a read-only synthesis is worth the additional model call. Its result is one of `CONTINUE_CURRENT_CONTRACT`, `G2_REENTRY_REQUIRED`, `G1_REENTRY_REQUIRED`, `OWNER_DECISION_REQUIRED`, or `NONCONVERGED`; the result grants no authority by itself.
- `CONTINUE_CURRENT_CONTRACT` resumes only when current authority and fresh state already permit the named work. `NONCONVERGED` remains an Owner/Web decision state. Immediate authority barriers return directly to the relevant decision boundary rather than consuming diagnostic cycles.
- Web-selected STRICT adds the required explicit Lock and adversarial obligations.
- The Loop Manager cannot select or downgrade the assurance path.
- Newly exposed material risk holds the affected lane with `RISK_RECLASSIFICATION_REQUIRED` until User/Web reclassifies it.
- Gate reuse is allowed only when the current accepted Lock exactly covers task, scope, trust boundary, material assumptions and causal/contract evidence required by that gate; otherwise `GATE_REENTRY_REQUIRED`.
- G3 must not invent architecture outside its accepted contract.
- Before launch, transition, merge/finality, or next-gate authority, reconcile exact head, child/PR/parent, Lock/authority, checks, reviews/threads/findings, current programme state and any action-material CURRENT identities.
- Before merge/finality, every first-party repository CI/check run triggered for the exact candidate head must be terminal. Pending, queued or in-progress CI is never green and must block merge even when GitHub branch protection would technically allow it.
- Every applicable first-party candidate-validation check must conclude success. A skipped/neutral result is acceptable only when that workflow/check is explicitly non-applicable to the candidate rather than a validation failure. A first-party red/failing candidate-validation check always blocks merge.
- External/advisory/provider checks may be classified separately only when the accepted contract already makes them non-gating and Web records the exact reason; branch-protection permissiveness alone is never such a reason.
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
- After a substantive terminal packet, Web should normally reconcile only live identities/state needed to prove the packet still applies. Do not refetch broad logs/history merely to reconstruct information that the terminal packet was required to contain.
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

- Toolkit-managed GitHub programme/child surfaces are deterministic projections of canonical programme/child state, not independent authority.
- Canonical state must preserve one programme identity and one identity/classification/lifecycle record per registered child. Generated presentation must not invent a second authority identity or omit a registered child.
- The authorised renderer/schema owns concrete presentation mechanics such as title syntax, Markdown sections/order, label names, parent-list layout, escaping and wording. Change those through the renderer contract and regression tests, not by expanding Controller law.
- Title, body, labels and parent-list output that are renderer-managed must reconcile from the same canonical snapshot and be read back together so one surface cannot silently drift from the others.
- The bounded CURRENT projection is the minimum restart surface of existing canonical state, not a new authority object. Where applicable it must expose repository, bound Controller revision, canonical main, programme parent, CURRENT child/lane, active RUN/Lock/gate/repair count, active PR/head/tree/base, HOLD/dependency, in-flight execution state, exact controlling authority/receipt pointer, and next admissible action.
- Any material transition that changes those current facts must update the owned canonical state/projection and read it back before the next consequential continuation. A stale CURRENT projection that forces chronology archaeology is a reconciliation defect.
- Where current authority depends on a durable receipt/comment/object, project its exact identity in CURRENT state so takeover can fetch that evidence directly rather than enumerate chronology.
- Labels and other presentation metadata are visibility/discovery aids only; they do not grant ownership, authority, gate status, completion or finality.
- The programme parent owns programme identity/objective/material boundaries, the registered-child catalogue and order/lifecycle, cross-child dependencies/authorised concurrency, programme-wide holds, terminal child dispositions, deferred-owner relationships, Web acceptance references and programme finality.
- Operational execution truth belongs to the relevant child: scope/root/run/Lock/gates/repair/evidence/candidate/holds/next action.
- Keep the parent minimal; child-local operational changes must not churn the parent except where the canonical parent projection itself changes.
- Children use `QUEUED`, `CURRENT`, `COMPLETED`, `RETIRED`; `CURRENT` means live work. Multiple CURRENT children/lanes may exist only under current authority.
- Historical comments/prompts are evidence/chronology, not automatically current authority.
- Every retained material `POST_SHIP` decision has one stable canonical deferred record and exactly one verified continuing owner. Ownership grants no implementation authority.
- Before a deferred-record owner terminates, each retained record must be implemented, discarded with reason, superseded with evidence, or transferred with verified readback.
- Prefer a suitable future child as deferred owner; otherwise use the accepted standing Improvement Queue, which is non-executing and never CURRENT merely because it contains records.

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

- Final Audit is the whole-programme completion audit for the final programme scope and is read-only. Its concrete route resolves from the selected stack registry.
- Admit it only after every required programme child/task/lane is terminal or explicitly resolved; all required candidate G4s are complete; all intended integrations/merges are complete and canonical state is read back; and no mandatory blocker, HOLD, non-convergence decision, or unresolved owner decision remains.
- Never trigger Final Audit merely because one PR, child, or task is described as `final`, `last`, `ready`, or appears to be the last implementation item.
- Final Audit never substitutes for G4, repair, unfinished work, integration, reconciliation, or missing evidence.
- Web explicitly launches and adjudicates Final Audit and retains terminal programme closure authority.
- If any required work remains after a would-be final PR, continue that work under the ordinary gate model; do not spend the selected Final Audit route as a per-PR or per-child super-G4.

## Terminal GitHub object receipts

- Every Toolkit-managed GitHub issue or pull request that enters a terminal state under current governance must have a durable terminal receipt on that same issue/PR for that terminal episode. Terminal states include issue closure and PR merge or close-without-merge.
- The receipt explains why the object became terminal. It must identify the terminal disposition, controlling authority/child or Lock where applicable, the decision/evidence basis, and any continuing owner or successor for work not completed in that object.
- A merged PR receipt also binds the exact integrated commit plus candidate head/base identities when available. A closed-unmerged PR receipt records why integration was intentionally not performed and the candidate/branch disposition. A closed issue receipt distinguishes completed, superseded/transferred, duplicate, not-planned, or other evidence-backed disposition.
- Exact receipt wording/layout is renderer/automation policy, not Controller formatting law. The semantic receipt must remain concise, self-sufficient for later reconciliation, append-only, and secret-safe.
- Where the terminal outcome is known before closure, publish and read back the receipt before the terminal mutation when practical. For merge or ambiguous transport where final integration identity is known only after the operation, first reconcile the terminal outcome by readback, then publish/read back the receipt immediately.
- A terminal transition is not governance-complete until the receipt is durably read back. If the object is already terminal but the receipt is missing, stale, or unverifiable, return `TERMINAL_RECEIPT_INCOMPLETE`; do not reopen or replay the terminal operation merely to add the receipt. Backfill/repair the receipt and verify readback.
- This requirement applies to every terminal transition performed under this revision. Historical terminal objects are not bulk-replayed solely for receipt backfill; if an older terminal object becomes decision-relevant and lacks an adequate receipt, backfill it before relying on that terminal disposition.
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
