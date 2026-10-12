# Toolkit V3: delivery contract and transition

Status: owner-directed implementation target, prepared 12 October 2026. This document is the complete V3 direction for Toolkit parent [#421](https://github.com/weijunswj/ai-agent-toolkit/issues/421) and coordinated Core owner [#461](https://github.com/weijunswj/ai-agent-toolkit/issues/461). Publishing this document does not establish implementation, installation, UAT, review, worker suspension or programme completion.

The owner has authorised this preparation and instructed dot to manage implementation after handoff. The deadline is **12 October 2026, 23:59 Singapore time (15:59 UTC)** for a usable, accepted V3 Core. The deadline does not waive a required outcome or turn incomplete work into a pass. Report a remaining gap plainly if that target cannot be met.

## 1. The product and the finish line

Toolkit is a portable delivery framework. A user gives a controller an outcome; the controller and executors discover the real environment, agree the complete scope, build a usable version, obtain user acceptance, independently review it, and finish the authorised delivery. Source, decisions, evidence and the next action survive a change of chat, model, harness, environment or controller.

The normal coding workflow is **G0 Discovery → G1 Builder, including UAT → G2 Review**. This becomes Shipping Law and the default Toolkit coding governance unless the user specifies another workflow. The user should spend attention on the product, unresolved material choices and actual acceptance. Routine implementation, state updates and already-authorised evidence transfers proceed without repeated permission questions.

V3 must work through ordinary Web-controller use and persistent dot-controller use using the same underlying scope, route, authority and acceptance decisions. A fresh executor receives one usable prompt/packet; it must not need the producer's chat history, dot memory or a controller's reconstruction of months of comments.

Track builder functional readiness, owner UAT, G2, custody, integration/active installation, GitHub reconciliation, Core release and parent completion separately. A GitHub outage can leave exact durable acceptance as “UAT_ACCEPTED_PUBLICATION_PENDING”; G2 may review the accessible exact candidate. It is not “CORE_RELEASE_DONE” until required publication, integration and installation finish. Preserve pending updates, inspect uncertain prior outcomes before replay, preserve concurrent edits and independently read back only outstanding mutations. Do not repeat unchanged acceptance for an administrative outage.

Completion has three distinct meanings:

| Completion | Required result |
|---|---|
| A milestone | Its agreed observable outcome is satisfied with the required evidence. An incomplete checkpoint explains remaining work and is not milestone completion. |
| Current Core release | The complete approved Core works in the agreed environment; builder and user accept it; fresh G2 passes the final candidate; authorised integration and installation are verified; custody and recovery work. |
| Parent #421 | Every committed Core, Hardening and Later obligation is completed or explicitly disposed of by the user, with any agreed transfer having a real continuing owner. Closing the first Core does not close the parent. |

Do not make record neatness, a new optional suggestion or an unrelated capability a hidden prerequisite for shipping the approved Core. Conversely, a paper contract, synthetic replay or green CI cannot substitute for the actual usable result.

## 2. Authority, supersession and safe adoption

The owner's V3 instruction replaces conflicting **user-owned Toolkit process requirements** for this programme. Apply it at a recoverable transition boundary. Preserve higher-priority instructions, actual native permissions, secret handling, unrelated work and necessary controls on consequential effects. A repository document cannot manufacture a direct owner approval recognised by a host.

Dot should first stop new legacy admissions for this programme and reconcile any existing writers. The public preparation notice is [the V3 transition direction](https://github.com/weijunswj/ai-agent-toolkit/issues/421#issuecomment-6118364504). Treat each active worker as `pause requested` until its actual host/session confirms its checkpoint, pending effects and writer state. Do not blindly terminate a process, erase a worktree or infer a stop from a GitHub status.

No wholesale deletion of Toolkit, AGENTS files, dot configuration, hooks or installed skills is required. Replace the applicable canonical instructions, regenerate owned projections, qualify a candidate installation and deliberately change the active entry point. Preserve a usable rollback. Unrelated repositories retain their existing bindings until separately adopted.

The following are replaced for new V3 work:

| Legacy requirement or failure mode | V3 replacement |
|---|---|
| G0–G4 with separate framing, contract, implementation and closing admissions | Three roles: strong G0 discovery, continuous G1 build/UAT, fresh G2 assurance. Logical work remains; most handoff ceremonies do not. |
| Mandatory mini-child execution and repeated controller re-dispatch | One builder assignment for the complete approved Core, with internal checkpoints and fresh sessions as needed. |
| Weak G0 making product or architecture decisions | G0 uses the G1 strong lead binding; both leaf roles preserve the old G0 binding and suitable separable evidence gathering or independent implementation/validation is delegated by default, with the exceptions in section 10. |
| Default duplicated closing panels, DUAL_MAX or an automatic extra final-child review | Explicit G2 coverage of both scope and execution. No duplicate review merely because a child is last. |
| Ordinary fixes forcing architecture re-entry or new tiny correction admissions | Builder fixes within the agreed outcome and effects. Re-plan only when a material scope, product, trust or feasibility decision changes. |
| Arbitrary retry/chat counters as a substitute for progress judgment | Continue while there is a defensible new hypothesis or measurable progress within authority. Stop repetition, reconcile effects and expose the concrete blocker. A new chat does not erase denials or history. |
| Controller rewriting every receipt and policing cosmetic records | Executors publish their own concise progress, evidence and continuation packet; deterministic projection maintains the parent. |
| Repeated full bootstrap/history reads on unchanged refreshes | A small current entry point, release brief and checkpoint, with relevant source/instructions loaded on demand. Refresh when the applicable revision, role, scope or evidence changes. |
| Per-operation permission questions for already-authorised routine work | Persist and correctly propagate bounded standing authority using the host's supported mechanism; test it end to end. |
| Hardening or feature ideas treated as automatic ship blockers | Classify against the approved release, obtain approval for material scope additions and retain future work in the right queue. |

Old gate names and receipts remain valid descriptions of historical work. Do not relabel an old G2 design review as the new final G2, reset exhausted unsafe operations, or erase a denial. Existing genuine outcome, privacy, integrity, recovery and platform requirements survive unless explicitly changed here or by the user. Obsolete process limits do not require the old process's permission to be replaced by its owner.

Preparation may be adopted from the exact reviewed preparation revision in the owner's handoff before the entire product rewrite is merged. Record that revision once. Keep it scoped to Toolkit V3; do not silently activate this migration in other repositories or in an already-running worker.

[PR #513](https://github.com/weijunswj/ai-agent-toolkit/pull/513) is the current V3 proposal continuation; [PR #512](https://github.com/weijunswj/ai-agent-toolkit/pull/512) retains the earlier preparation. Reconcile the older PR's superseded disposition through its authorised lifecycle and read back the parent/child current pointers against the exact proposal revision. Until those updates are verified, report projection reconciliation as pending; an open historical preparation PR does not make its older text a competing current contract.

## 3. Core, Hardening and Later

Use three categories on the existing programme, with a stable child issue for each coherent outcome. **Do not create CORE, HARDENING or LATER container issues.**

| Category | Meaning | Admission |
|---|---|---|
| CORE | The complete usable release currently approved for delivery, including its necessary security, privacy, integrity and recovery floor. | The user agrees the outcome. Routine means of achieving it are delegated. |
| HARDENING | Further resilience, security, reliability, performance or operational assurance of delivered capabilities, beyond a present release blocker. | The user approves the next finite hardening scope when selected. It is not an automatic expansion of the current Core. |
| LATER | Committed future capabilities and other work not selected for the current release. | Preserve existing commitments. New material capabilities require user agreement before becoming commitments or entering a Core. |

Committed Later work is different from an optional suggestion. [#425](https://github.com/weijunswj/ai-agent-toolkit/issues/425) remains the optional improvement queue; it must not absorb committed n8n, Hostinger, Coolify or other programme obligations and thereby make them optional.

The release sequence is **ship a coherent Core with its necessary safety floor, address the next worthwhile finite hardening package, then deliver the next selected capability package with its own safety floor**. Do not wait for every conceivable hardening idea before adding capabilities, or defer all security until every capability exists. Urgent real defects take precedence according to their actual impact.

When a Core closes, G0 inspects what actually shipped and the remaining open obligations. Existing Hardening is the starting candidate for the next Core; related Later work may be proposed where it produces a more coherent result. G0 presents the next scope and category changes to the user. After approval, update the **same open children** and begin G1. Completed children and release acceptance remain closed history. Reclassification alone neither completes work nor changes its requirements.

A child spanning releases can keep completed acceptance sections and an explicit residual obligation while remaining open. Split it once only if separate ownership or acceptance is materially clearer. Do not mass-close and recreate children to make a board look fresh. Empty categories are valid.

For additions during a Core: an implementation clarification may be incorporated directly; a related material addition is proposed with its effect on the current finish line; a separate capability is normally proposed for Later. The user may explicitly bring an addition into the current Core. Being related to the parent does not itself authorise extra Core scope. Record the scope decision once and update the relevant acceptance and plan.

## 4. Where the plan and milestones live

The parent is the programme's current index. It holds the approved current Core outcome, included children, ordered milestones and dependencies, integrated acceptance and UAT environment, current position, material decisions, and the sorted Core/Hardening/Later catalogue. Each child holds its detailed acceptance, implementation checklist, source/evidence references, current checkpoint, blockers and next action.

The default milestone is **one coherent outcome child**. Several small existing contributor children may serve one integration milestone without acquiring independent gate cycles. A large child may have a few internal milestones when each represents a demonstrable user/consumer outcome or a valuable recovery boundary. File counts, arbitrary commit counts and token estimates do not define milestones.

For example, a web controller's Core might progress through an actual end-to-end working path, complete agreed behaviour and integration, and UAT readiness. Those are milestones only if they expose useful completion evidence. The builder continues into the next one under the same assignment; it does not wait for a new controller prompt solely because a checklist item completed.

After a relevant category, release, order, scope, status, blocker, readiness or completion change, regenerate the parent projection in **CORE → HARDENING → LATER** order, then the agreed milestone order. Completed and retired history is separate. Preserve child identity and decision references. This mechanical operation belongs in the authorised progress publication, not a new G0 session or a cosmetic reconciliation turn.

Use one canonical current packet and one current parent projection. Historical comments are evidence, not an additional source of competing current instructions. Updates must preserve concurrent edits or report a precise conflict. If a remote projection write is temporarily unavailable, retain the exact pending update in the checkpoint and continue independent authorised work; do not represent the stale projection as current or overwrite unseen changes.

## 5. G0 Discovery and planning

G0 is a strong reasoning lead. It inspects the real repository, running/target application, installed instructions, environments, dependencies, credentials **by reference**, existing work and decisive external integration behaviour. A repo-only guess is not adequate when the outcome depends on a deployed app, VPS, browser session or native harness.

G0 MUST delegate suitable separable evidence gathering by default. Helpers gather bounded facts, inspect files, run safe probes or catalogue evidence. The strong lead owns reasoning, architecture, decisions, contradiction resolution and decisive verification. The controller owns the assignment and records/enforces the owner's scope decisions, while making delegated implementation decisions within them; neither controller memory nor a helper's confident summary substitutes for primary evidence.

G0 produces one current release brief: intended working outcome; included and excluded commitments; coherent milestone order; actual environment and target host matrix; acceptance/UAT path; material unknowns; private custody location; authorised actions/effects; selected stack; and the exact next builder action. It updates the parent and relevant children. It asks the user only about an unresolved material choice, missing access or scope change. It must not ask the owner to re-approve decisions already made in this V3 discussion.

For this launch the owner has already approved V3's direction. Discovery therefore binds that direction to current source, installed state and acceptance. It is not permission to spend another day producing an alternative governance architecture.

## 6. G1 Builder, integration and UAT

G1 receives the whole approved Core. It MUST delegate suitable independent implementation or validation by default. The strong lead owns reasoning, architecture, decisive proof, integration, UAT readiness and final quality. It plans its implementation locally, reuses existing work where helpful, builds the complete version, runs meaningful tests, integrates contributors, demonstrates the result and resolves ordinary user UAT feedback. Multiple commits, bounded helper tasks and multiple executor sessions are normal parts of the same assignment.

The builder may investigate and repair ordinary defects without another controller admission. It may not silently change product scope, trust boundaries, paid services, destructive effects or the agreed acceptance. A missing capability must be investigated and named; an unsupported shortcut cannot be relabelled success.

G1 reaches the actual consumer boundary. Synthetic cases, fixtures and mocks are useful for controlled tests but must be identified and cannot prove a real installation, external integration, source control write or authorised operation they did not exercise. Report what ran, what failed and what was not exercised. Do not change tests or CI to conceal failures, substitute fake production data, or infer runtime success from documentation.

When the builder is satisfied, it presents the runnable test environment or project-appropriate equivalent for user acceptance. The user judges the agreed experience and scope. The builder resolves feedback within that scope. A genuinely new feature is handled by the scope rule. Silence or a scheduling target is not UAT approval. Acceptance applies to the demonstrated candidate, environment and criteria; a new SHA alone does not invalidate it. After a correction G1 supplies a compact impact record and dot records exactly `UAT_RETAINED`, `UAT_PARTIAL_REQUIRED` or `UAT_FULL_REQUIRED`. Repeat affected journeys when user steps, outputs, access/authentication, isolation, destinations, effects, persistence, migration/deletion/recovery, modes, material environment, scope or criteria change, or when earlier demonstration evidence is invalid. Retain demonstrated unchanged behaviour with targeted proof. Investigate uncertainty before requesting another owner run; use full UAT for a cross-cutting or unbounded impact after investigation. Preserve the original approval and its applicability evidence. G2 may challenge reuse but cannot manufacture owner acceptance.

The desired normal interaction is G0, G1/UAT, then G2 and closure: about three role episodes, often three or four human handoffs. It is not a promise that any size project finishes in three model responses. Internal progress and session recovery must not create compulsory user approvals.

## 7. Context, checkpoints and mandatory fresh executor sessions

Keep one current packet and load relevant changed source on demand. Initial adoption understands this contract; unchanged continuation does not repeat the whole history. A milestone is an observable outcome. An execution segment is a bounded working slice between renewal boundaries. A checkpoint is recoverable state, including incomplete or failing work. A fresh chat is a new executor context continuing the same approved assignment.

The initial G1 execution segments are: instructions and routes; checkpoint/publication/custody/cleanup; native qualification on the three hosts; and integrated UAT/G2 readiness. Fresh executor contexts are mandatory between G0 and G1, after each planned G1 segment before the next, for initial G2, on a model/effort/harness switch, runtime/environment replacement, activation of a new instruction/profile version, replacement of an executor, and at a safe boundary after session loss or forced compaction. An ordinary commit, test, helper return or tool call does not require renewal. A remote connection alone does not imply an environment replacement.

Checkpoint after a substantive completed turn, before and after consequential operations, after meaningful helper returns or expensive evidence, before transfer/disposal and at every renewal. An unchanged status observation does not require another upload. Checkpoint failing segments honestly. Preserve pending effects, denials, resource limits and prior consumed history. Reconcile uncertain external effects before replay.

Each checkpoint identifies programme/release/child/role and applicable contract; exact source and recoverable delta; results and remaining obligations; evidence and verified custody; environment/profile/version; writer state and pending effects; scope/authority and real denials; and one concrete next action. Large source/logs live in approved custody with immutable identities, not recursively embedded in packets.

A checkpoint-only save persists changed recoverable state and the current executor continues its safe authorised work. Saving a checkpoint does not itself stop that executor or launch a successor. Quiesce the old overlapping writer only for an actual fresh-context transfer required by the renewal boundaries above; verify the recoverable checkpoint before Dot's supported launcher starts the already-authorised fresh executor without another owner approval for unchanged scope. A checkpoint save/verification failure is a recovery boundary: preserve the working source and evidence, hold dependent effects and repair recovery; it is not an automatic successor-launch trigger. Do not admit competing writers. If renewal cannot be automated, report the exact capability gap and preserve the launch-ready packet. Credentials and native permissions still have to exist on the receiving host.

Bind the next segment to its checkpoint and durable successor identity. Before launch, reconcile an existing successor or uncertain prior launch; after controller session loss, recover that state before replay. Launch exactly one successor when the next work is authorised and its dependencies are satisfied. A valid failing checkpoint may continue into authorised repair or validation without falsely advancing a dependent milestone. A genuine permission or capability hold blocks only dependent work and remains visible.

Before dependent work on a receiving chat, model, harness or machine, verify access to the exact source revision and recoverable delta, retrieval of the required private evidence, required tools, native model/profile, the supported permission route and the actual target identity. The controller/launcher verifies the native model/profile through supported launch configuration; the receiving executor verifies its source/evidence/tools/target access. This does not require worker model introspection or self-admission. Reuse still-applicable evidence on an unchanged host; do not assume credentials, paths or installed binaries transfer between hosts. Record only missing or changed capabilities and their affected work. This qualification does not restart completed product discovery.

## 8. G2 Review and finding disposition

G2 starts after G1's working version and user UAT are accepted. It uses fresh independent reviewer contexts and the actual candidate, complete approved scope, evidence and installed/test environment references. G2 does not spawn subagents. The controller may assign independent peer reviewers directly.

For this broad V3 change, use **two complementary independent peers**: one concentrates on scope and implementation correctness, the other on execution, evidence, installation, authority and recovery. They may both report any defect. For subsequent small Cores, one independent reviewer is the normal minimum; add another for a concrete risk, explicit requirement or uncertainty. Do not add a third reviewer or DUAL_MAX automatically.

The selected stack must bind the actual available model and reasoning setting. For OpenAI-only V3 review, the launch default is Sol 6.1 XHigh and Astra 6 High in separate contexts. Where the owner-selected mixed route is available, Sol 6.1 XHigh and Opus 5.5 XHigh provide the two roles. The Claude-only route uses two independent Opus 5.5 XHigh contexts with the complementary assignments above. Do not silently change provider, model or supported capabilities to obtain a pass. These are launch assignments, not claims of measured model superiority.

Review covers the original scope, real functionality, implementation quality, meaningful CI/tests, security/privacy floor, authoritative instruction composition, real installation and environment behaviour, transport, continuation and incomplete promises. Remove old duplicate assurance only after its substantive coverage is represented here.

Classify each finding as one of:

| Disposition | Required explanation and action |
|---|---|
| Current ship blocker | Identify the agreed criterion or necessary safety invariant, concrete failure or critical absent proof, present release impact and smallest adequate fix. G1 fixes the coherent blocker set. |
| Hardening | Explain the useful additional protection and why current acceptance can still be met. Retain it for user-approved future scope. |
| Later capability or optional suggestion | State the new outcome and proposed owner/queue. Do not silently add it to the current Core or make an optional idea a programme commitment. |
| Unsupported or duplicate | Explain the evidence problem or link the existing finding; do not create another work cycle. |

Deadline pressure is not a reason to demote a real blocker. Reviewer preference, speculative universality or an unrequested feature is not a reason to block. When reviewers disagree, resolve the specific criterion and evidence; do not default to another full panel or majority voting.

G2 actively tries to falsify the product, scope, execution and recovery claims. The two initial peers receive the same exact candidate and scope in fresh independent contexts and return independently. Share adjudicated findings; do not expose an unreturned current peer verdict to the other peer.

Return the coherent blocker set to G1. Reuse the existing reviewers by default for corrections, giving the corrected candidate, cumulative diff, findings/reproducers, validation, UAT applicability and coverage. A prior PASS is not an automatic PASS for changed source. Replace only an affected reviewer who is unavailable, unrecoverable, compromised in independence, participated in implementation, saw a premature peer verdict, changed model/harness, or lost necessary context. Do not restart both panels for every fix or introduce DUAL_MAX. Expand affected coverage when the real change invalidates earlier assurance; apply section 6's UAT impact rule.

## 9. Consequential boundaries without restoring the old gate system

Some operations need assurance before their real effects: changing live permission-controlling instructions, destructive migration, privileged production mutation or irreversible publication. G1 may construct and test candidates in an isolated branch/profile with existing host controls intact. Before exercising a consequential real effect, establish the applicable authority, exact scope, recovery and the narrow source/effect checks needed for that boundary.

For Toolkit, keep candidate governance out of the active instruction path during initial development. G1 performs a bounded source/authority check before loading a candidate into an isolated test profile; this is part of building and testing, not another routine gate. Exercise it with harmless or explicitly authorised effects for UAT. After the final reviewed source is accepted, activate that exact candidate and verify installed files, hooks, versions and entry points. If installed payloads differ from the reviewed source, review the material difference before treating the installation as accepted.

An independent design challenge is exceptional and targeted to a real unresolved consequential design risk. It is not a fourth routine role. For the mixed stack, use **Sol 6.1 XHigh only** for that challenge; remove Astra from the mixed design-review assignment. Its output resolves that specific boundary and returns the builder to work.

Final source review and installed proof answer different questions. Both are necessary where the product controls instructions or authority. Satisfy them within the three-role flow using isolation, a narrow pre-effect check and final installed readback.

Before final G2, the existing release brief records merge, local installation and active-entrypoint activation separately as authorised or pending. For each, bind the exact owner-authority reference, repository/branch/candidate or host/profile target, permitted effects, native permission route, prerequisites and rollback. This is an authority applicability record, not a new grant or review gate. Do not infer one operation's authority from another or from a general development instruction. Reuse genuinely applicable approval without asking again; hold an unauthorised effect while independent implementation and read-only review continue. Missing required integration or activation still prevents Core release completion.

## 10. Model and subagent bindings

Rename roles by meaning, not by reusing the old numeric keys blindly. Old G2 was a design role; V3 G2 is final review.

| Stack | G0 Discovery and G1 Builder lead | G0.Subagent and G1.Subagent |
|---|---|---|
| Owner OpenAI | Sol 6.1 High | Luna Max |
| Owner Claude | Opus 5.5 High | Haiku 5.5 XHigh |
| Owner mixed Claude/GPT | Opus 5.5 High | Haiku 5.5 XHigh, preserving that stack's previous G0 helper binding |

G0 and G1 use the same strong binding, not necessarily the same chat. Both helper roles preserve the selected stack's **previous G0** binding; do not alias them dynamically to the newly promoted G0 lead. G0 helpers collect evidence. G1 helpers perform suitable bounded independent implementation or validation by default; the builder integrates and validates. Helpers are leaves: no recursive delegation, scope approval, gate dispatch or final acceptance. Exceptions are trivial or inseparable work, overhead exceeding benefit, tightly coupled reasoning or integration, a genuinely unavailable exact helper route, or a real authority or safety boundary. Briefly record the reason when substantial work proceeds directly. No helper quota, ceremonial or nested delegation, or extra owner permission is required for already-authorised direct work.

For the owner OpenAI route, G0/G1 use Sol 6.1 High and both leaf roles preserve Luna Max. Verify model and effort at the actual trusted launcher boundary. Service tier is a controller/launcher concern. The owner's separate direct instruction of 12 October 2026 stops Priority for all repositories: future launches use Standard, superseding prior Priority approvals. Its exact provenance is retained in the controller's authorised owner-instruction record. Each authorised controller/launcher applies that decision through its supported configuration; this Toolkit-scoped PR does not itself change another repository or grant cross-repository mutation authority. This source does not change or attest an already-running inference session. Worker and helper admission must not require tier awareness, introspection or a tier receipt, and lack of a helper API tier field must not prevent suitable delegation. Preserve actual model/effort availability, native permissions and topology limits; report a genuinely unavailable model/effort route without silent substitution.

G2 peers have no subagents. Opus 5 is retired in favour of 5.5 wherever the selected profile uses Opus. Resolve actual availability and reasoning support through the existing registry/resolver family and trusted harness configuration; names in a packet do not prove the realised route. No new provider/model/effort fallback is authorised. Use an applicable explicit prior owner decision or obtain a new material decision. A same-approved-model harness switch is not model substitution, but still requires permissions and a checkpoint. If an exact helper route is absent, the strong lead may proceed directly with the substantial-work exception recorded. If a G2 route is absent, preserve completed review and continue independent work while reporting the exact gap.

Trusted launch evidence binds role, stack/registry revision, provider/model/effort, effective defaults and overrides, actual parameters or consumed configuration, native acknowledgement and any exposed effective route, clamps or ignored settings. Where backend identity is hidden, supported consumed configuration plus native acknowledgement can establish “LAUNCH_CONFIGURATION_VERIFIED” with “BACKEND_IDENTITY=NOT_EXPOSED”. Self-report does not establish either. An ignored setting is not success. Correct effective selection and wrong-route prevention are separate requirements. Workers do not select, change or attest service tier; tier remains a controller/launcher concern.

## 11. Controller and executor responsibilities

| Controller owns | Executor owns |
|---|---|
| User relationship, obtaining/recording material scope decisions, applying approved release ordering, assignment and independent review routing | Investigation and implementation inside the assignment, default suitable leaf delegation and integration |
| Conflicting authority, competing writers and consequential cross-work boundaries | Meaningful tests, real validation, UAT-ready delivery and ordinary corrections |
| Resolving a genuine finding dispute and recording final accepted disposition | Direct publication of concise progress/checkpoints and authorised private evidence |
| Confirming completion and taking the next already-authorised programme action | Verifying custody, eligible temporary cleanup and an immediately usable return packet |

Do not route every mechanical GitHub edit or evidence upload through the controller. Give an executor the necessary bounded operation and current record identity with its assignment. Use the available supported connector, API or CLI; the route must be authorised and capable. Avoid ceremonial helper dispatch merely to proxy a working native tool.

Controllers remain accountable for programme truth, but they do not need to retype valid worker receipts. Deterministic validation should check identities, required fields, update conflicts and links. Judgment remains with a strong lead where it matters. A controller may also be wrong; decisive source and effect evidence must be independently checkable.

## 12. Approval provenance and diagnosis

V3 must audit the actual blockers in local and cloud routes, including effective global/repo instructions, installed plugin hooks, model launch settings, host approval policy, connector scope, sandbox/network capabilities and worker delegation. Diagnose the layer that denied the actual operation before editing policy.

An observed [#501 transport approval record](https://github.com/weijunswj/TRANSPORT-ai-agent-toolkit/blob/1f2fe6a9c18dcf915f0ab1f9cd99e633ec39720d/archives/TK-A7F2/admissions/501-phase-b-fresh-context-20261006-0735.json) distinguishes an initial rejection of embedded delegation from a later direct owner approval. This shows that the embedded delegation was not accepted as direct native authorisation on that route. It does not establish a platform defect or the cause of every approval prompt. G0 must establish where the supported standing authority should be supplied. Preserve exact rejection text privately where necessary.

Represent standing authority concretely: owner/provenance, repository or destination, purpose, permitted operations and effects, data boundaries, expiry/revocation if any, and permitted cleanup. The active host must receive it through its supported trusted configuration or approval mechanism. Do not solve the problem by writing a more emphatic assistant-authored permission claim.

Routine in-scope operations should execute without a new owner prompt. If a platform requires a direct owner action, give one precise explanation of the exact native requirement and why the earlier grant was not accepted. Preserve the unresolved operation, perform independent work and avoid repeated identical approval attempts. No silent weakening of native controls, misrepresentation of forwarded instructions or route switching to evade a real denial.

Acceptance must include harmless real controller-to-executor operations: issue/progress publication where authorised, private transport upload/readback and eligible cleanup. Run them on the actual intended local/cloud route. Record whether the original standing grant was recognised and whether an unexpected prompt occurred. A safe denial is a valid negative test, but it does not satisfy a required operation that remains impossible. A successful Web connector write alone does not prove executor or cross-harness approval propagation. Demonstrate a harmless operation, a repeat on another task artifact and a repeat in a fresh session on each applicable route. Test an outside-scope negative without broadening authority. Include authorised GitHub progress, private upload/readback and eligible cleanup. One supported native setup approval is acceptable; session-only approval is not persistent standing authority. Unexpected repeated prompts or a host that cannot persist the exact bounded grant remain a precise platform limitation, not an unattended PASS. Changed identity, revoked authority, a new destination or expanded consequential effects can legitimately require approval.

Recovery reuses retained evidence only while its exact identity and applicability remain valid. Resolve and refresh the specific missing ownership, active-use, mapping or authority fact instead of restarting completed discovery or approval cycles. Hold only operations that depend on the unresolved gap. Carry the exact existing owner approval through the supported native mechanism, and reconcile uncertain effects before any permitted retry. Missing facts never constitute a safety pass; real overlap, target drift, active consumers and native denials remain controlling.

## 13. Private transport, evidence and cleanup

The default operation is straightforward:

1. Work and test in the assigned environment, including a VPS where appropriate.
2. Upload the needed evidence/data and continuation state to the **already-agreed private store**.
3. Verify the stored identity and a consumer's ability to recover it.
4. Delete eligible, completed, Toolkit-owned temporary material according to the agreed retention policy.
5. Return the packet to the controller or next executor.

For Toolkit, the existing agreed store is `weijunswj/TRANSPORT-ai-agent-toolkit`. Reuse it. When no store is agreed for another project, discuss the storage choice once; recommend a private TRANSPORT repo by default and use the selected method immediately. Raw secrets, unnecessary personal data, unrelated files and oversized generated bodies do not belong in an evidence upload. Refer to credentials through the approved secret mechanism.

The producer owns this transfer; the controller may assist only when the worker genuinely lacks an authorised supported route. A completed assignment must not leave its only recoverable evidence in an ephemeral chat or VPS directory. If transfer fails, report `custody pending`, preserve the local material and exact pending operation, and continue only work that does not risk it. Do not delete the sole copy.

A compact manifest identifies source/candidate, artifact purpose, path, digest or immutable revision, producer, creation time, retention/expiry class and any active reference/pin. Keep a stable current index and bounded receipts. Do not recursively embed complete previous receipts, repository listings or downloaded archives into new receipts.

Retention must be implemented, not merely documented. Keep active, referenced acceptance and recovery material. Prune expired or superseded bulk that is no longer required and is owned by this workflow, after verifying the relevant retained copy and pin/reference rules. Compact terminal decisions and evidence indexes can outlive large raw logs. Run eligible cleanup as part of completion or a normal bounded housekeeping operation, without per-file owner approvals when already covered by standing authority.

Local disposable Toolkit-owned material may be cleaned immediately after verified durable custody and consumer retrieval, when no active process, pending effect, installation/rollback dependency or ownership uncertainty needs it. There is no 30-day local minimum. Uncommitted work is not disposable until preserved; failed transfer is “CUSTODY_PENDING” and retains the sole copy.

If durable custody and readback succeed but the producer crashes before eligible local temporary cleanup, retain the pending cleanup identity in the existing checkpoint/manifest. A successor recovers that pending work without the original session, verifies the retained copy and rechecks exact target ownership, active consumers, references/pins and current authority, then completes only still-eligible cleanup or records the specific hold. Do not delete an active worktree or the sole required copy; verified upload alone never makes either disposable. Reconcile any uncertain prior deletion outcome before retry, and update the existing retained references after independent outcome readback.

Remote temporary bulk becomes eligible 30 days after all identified required consumers finish or transfer to a verified successor, including implementation, UAT, G2, installation, recovery and downstream work. The latest consumer completion starts the clock; parent closure alone does not. Require elapsed retention, no active consumer or pin/hold and verified ownership/scope. Pins identify reason, consumer/owner and release condition for unresolved work, acceptance/review, downstream recovery, rollback, necessary retained-claim proof or other applicable holds. Historical hyperlinks alone are not permanent pins. Retain compact decisions and necessary substantiation rather than every raw duplicate. Unknown retention holds only the affected artifact.

The producer performs eligible local cleanup and existing bounded remote housekeeping using the current manifest; do not invent another ledger. Use controlled fixture/time tests for retention instead of changing production timestamps or waiting 30 days. Existing legal requirements and explicit owner holds remain applicable.

Deleting a tracked file removes it from the current tree, **not from Git history**. Avoid large binary churn and recursive payloads in the first place. If bulk requirements exceed a practical Git store, propose an agreed object/blob store with the TRANSPORT repo retaining the small index. Repository deletion, force-pushed history rewriting and deletion of user-owned or still-required data are not implied by routine cleanup. No claim of physical erasure without evidence through the actual storage system.

For eligible cleanup, retain required evidence, verify the exact disposable target identity and ownership and the absence of remaining consumers, refresh the facts material to each consequential operation, and independently read back the actual outcome. Valid retained direct-use and mapping evidence may be reused without another global census; semantically reordered mapping members or verified observer descriptors must not manufacture dependencies. Unknown backend or alias facts material to cleanup hold affected targets until sufficient exact identity/equivalence or disjointness evidence resolves them. A denied irreversible operation remains held until its actual supported approval path accepts; no duplicate retry or expanded disposal scope is implied.

Keep cleanup eligibility valid through the actual destructive boundary. A new active consumer, changed target identity or changed alias after the final eligibility check must prevent a prohibited deletion at that boundary. Use the simplest supported exact-target ownership/exclusivity mechanism, or hold the affected effect when that guarantee cannot be established; a stale eligibility result is insufficient. Do not introduce distributed locks unless demonstrated unsafe concurrency requires them. Test the real cleanup execution path on controlled disposable fixtures, with independently observed zero prohibited deletion when the intervening change occurs.

## 14. Installation and supported surfaces

Native Toolkit plugins target **Codex, Claude Code and OpenCode**. Antigravity is **portable skill copy only**; remove native AG2 install/update/sync and native qualification claims. Preserve useful portable content and its copy path.

The approved selected qualification matrix is Codex: Sol 6.1 High with Luna Max; Claude Code: native Opus 5.5 High with Haiku 5.5 XHigh; OpenCode: Sol 6.1 High with Luna Max. Native identifiers and supported effort mappings must be verified. Claude qualification does not require an OpenAI route through Claude. The OpenAI G2 pair is Sol 6.1 XHigh and Astra 6 High; mixed profiles remain separately selected under section 8. No missing exact route authorises fallback.

Before inference, deterministically enforce G0/G1 requested-helper permission, selected profile and registry revision, effective provider/concrete model/effort and native defaults, precedence and overrides. Omitted invocation settings are valid only when the actual approved resolved default is established. Reject conflicting explicit settings without silently rewriting them. Return machine-readable mismatches. Leaves and G2 cannot delegate; a valid request without helpers does not auto-spawn helpers.

On Codex use the actual blocking PreToolUse path for “spawn_agent” and the “Agent” alias with the supported blocking decision/exit. SubagentStart or “continue:false” is insufficient; a native function path is not proof of hosted/cloud coverage. On Claude use parent PreToolUse for Agent and the fully qualified loaded agent, including native invocation/environment, definitions, inheritance, restrictions and session state. A child hook or SubagentStart is insufficient. On OpenCode bind the installed API generation: V1 “tool.execute.before” for task, or V2 “ctx.tool.hook execute.before” for subagent. Verify the final supported pre-dispatch boundary or immutable consumed configuration; do not mix schemas or assume one hook covers AI SDK and native paths.

Qualify configuration/hook registration, ignored overrides, errors, timeouts, missing/disabled hooks, malformed configuration, post-check changes, resume/fork restoration and alternate entry paths. A trusted launcher must assert registration if a missing hook cannot reject itself. A fail-open host requires an enforceable launcher or disabled uncontrolled helper path. Distinguish inert child-object creation, first inference and task effects: unchecked objects may exist only if they cannot infer or work. Require zero wrong-model inference and task execution.

Per exact host path, test all fifteen cases: correct route executes; wrong provider/model; wrong effort; inherited wrong default; correct pinned default; conflicting override; guard error; guard timeout; missing/disabled hook; malformed configuration; post-check configuration change; fork/resume; alternate entry; G2/leaf delegation; and no helper request causing no automatic spawn. Use a controlled downstream interceptor for negatives instead of real wrong-provider calls. If a bad request escapes the guard to that interceptor, the guard test is FAILED even if the interceptor prevents effects. Record host/version/profile, effective route, input, decision and downstream result.

An unenforceable exact helper path is “UNQUALIFIED” and cannot be used uncontrolled. Record direct strong-lead work as the allowed exception and continue independent work. Host PASS requires correct-route execution, wrong-route prevention and failure-resilience proof; documentation, a copied plugin or unit tests alone do not satisfy native qualification.

The earlier accepted Core's installed Codex path remains the minimum baseline: ordinary Web controller, persistent dot and a fresh Codex consumer must all work. **V3 Core also includes the revised Claude Code and OpenCode plugin paths and real qualification of the selected usable path on each of the three native hosts.** G0 binds the exact supported path/profile and demonstration per host; it does not decide unilaterally to drop one. Update all three source/adapters and make qualification explicit per host. Do not advertise a host as supported until its actual intended path is demonstrated. An unavailable host is a visible outstanding obligation, not a synthetic pass; reducing the approved Core host coverage is a scope decision for the owner, not an automatic deadline concession. Broader optional permutations beyond the selected useful paths remain with their existing host children.

Provide owner-first local/private installation and updating, including correct entry point, dependencies, active version, profile/cache consistency and rollback selection. Preserve recoverable update behaviour; remove stale Toolkit-owned plugin/cache/staging material only after the new active version is proved. `toolkit settings` remains read-only. Stable defaults do not become repeated setup questions. The automatic Toolkit update choice and host-local installation/update behaviour must use the revised native host set.

Preserve applicable [S1 setup/input semantics](https://github.com/weijunswj/ai-agent-toolkit/issues/460), including a distinct no-write pending-answer exit (23 in the existing accepted contract), invalid question data as a real failure, genuine SessionStart refresh through an admitted path, and truthful invocation results. Qualify relevant EOF, exit status, stdout/stderr, cancellation, privacy and Windows behaviour. Public marketplace distribution remains future scope; private local usability does not depend on it.

Installed proof checks effective instructions, hooks, profile, selected route and caches, not merely a copied file's presence. A new session must actually receive V3 rather than retired gate instructions. Source version, generated payload and active installation must agree. The builder may reuse sound installation and verification mechanisms; it must remove obsolete restrictive behaviour that survives in an active hook or launcher.

## 15. Security and operational commitments

Every Core includes the security, privacy, integrity and recovery necessary for its actual effects. Use local repository checks for relevant source, dependencies, secrets, configuration and authority-sensitive changes, with findings tied to concrete evidence. These checks must not depend on access to the Codex Security plugin.

The committed locally usable repository security-scanning capability is owned by [SEC1 #511](https://github.com/weijunswj/ai-agent-toolkit/issues/511). It has been restored as one distinct Later outcome because [#284](https://github.com/weijunswj/ai-agent-toolkit/issues/284) is completed trusted-CI/protection work and [PR #293](https://github.com/weijunswj/ai-agent-toolkit/pull/293) is closed unmerged. Those records are evidence to inspect, not proof that the requested scanner exists on current main. C3 owns publication conformance; A4/A5 own any separately selected CI/protection integration. Do not promise parity with a separate vendor product. The useful outcome is reproducible local detection, evidence-based triage and remediation verification on authorised repositories.

The programme also retains secret-reference/private custody, sensitive-file guards, external-operation authority, privacy-safe operational evidence, observability and notifications, backup/restore/disaster recovery, exact-revision deployment/health/rollback, n8n offline and authorised API handling, and separate Hostinger and Coolify capability work. These are not cancelled by V3. The parent catalogue binds them to existing issues and distinguishes current Core safety floors from later full capabilities.

## 16. Launch reconciliation of current Toolkit work

Public state at the preparation read was based on main `eed473bc5874781a795a29fb6c2b3d6632e9d047`. Private host process state was not established by that read.

| Work | Observed public position | V3 treatment |
|---|---|---|
| #461 coordinated Core | First coordinated construction underway; overall completion unproved. | Keep the owner. Obtain actual worktree/effects/custody checkpoint, then continue or replace its executor under the V3 contract at a safe boundary. |
| #501 | Synthetic cases reported passed; outer-supervisor evidence/custody hold and next qualification not started. | Preserve useful source, Phase A and evidence. Integrate applicable installation/authority work with V3. Do not require another old mini-cycle merely to release reusable bytes. Retain real qualification obligations. |
| #455 W2-A | Native Windows admission adopted/read back; actual dispatch/execution pending in the public record. | Verify host truth before pausing or touching the candidate. Keep required Windows/resource evidence; do not invent a Linux repair or replay all W2 as a blanket prerequisite. |
| #423 C2 | Comment Trace parked; named foundation contribution released to D1. | Preserve parked work and its base/delta. Integrate useful state/packet mechanics; defer nonessential display work without losing its owner. |
| #435 and #459 | Completed foundation contributions. | Keep their completed state and reuse applicable results. Do not reopen for V3 labelling. |
| #500 and other retired predecessors | Retirement/transfer history. | Preserve truthful disposition. Transferred work is not falsely marked product-completed. |

Reconcile source and actual intended behaviour once. Retain useful work, but do not spend the day proving maximal reuse. Do not create duplicate V3 delivery children for work already owned by #461 or its contributors. The parent has the ordered current view; detailed operational packets remain with their children/private custody.

Reconcile the current continuation projections of [A1 #462](https://github.com/weijunswj/ai-agent-toolkit/issues/462) and [#501](https://github.com/weijunswj/ai-agent-toolkit/issues/501) at the verified transition. A1's new V3 work uses sections 8–10's role mapping rather than the former routine G1.5 design-review topology. Distinguish #501's historical/run-bound limits from the explicitly adopted V3 continuation; preserve consumed attempts, genuine denials, unresolved effects, retained evidence and installed obligations. Bind the superseding revision and actual safe-boundary receipt before calling either current projection reconciled. Do not silently change an active worker's admitted contract.

The exact pre-transition #421 body is preserved and read back from the [private archive](https://github.com/weijunswj/TRANSPORT-ai-agent-toolkit/blob/7ade74ec5bf733444890f071d9872b77642d9870/archives/TK-A7F2/v3-preparation-20261012/parent-421-before.json). It is historical scope provenance, not a competing current plan.

## 17. Canonical implementation surfaces

Implement the replacement in the existing canonical owners and their projections. The preparation notice does not itself implement these changes.

| Surface | Required V3 change |
|---|---|
| `repo/CONTROLLER.md`, `repo/ARCHITECTURE.md` | Replace conflicting gate topology, ordinary correction/closing rules, controller workload, classification, review and context rules with this contract. Keep one current operating procedure. |
| `repo/contracts/agent-rules/ai-coding-agent-execution.md`, templates and owned repository shims | Make Shipping Law the default, align role/delegation and standing-authority wording, remove contradictory legacy requirements and regenerate managed blocks. |
| Current stack registry/schema/resolver and host launch bindings | Encode lead/helper separation and renamed gate meaning, actual model/effort selection, peer G2 without delegation and truthful unsupported routes. Avoid a second divergent registry. |
| Persistent-agent bootstrap, stack/helper profiles and externally installed bootstrap copies | Replace mandatory repetitive full reads and mechanical handoff constraints; load current essentials and refresh on change. Retire stale installed copies after replacement is verified. |
| Control-plane, packet/evidence compilers, GitHub state and reconciliation | Support one sustained builder assignment, recoverable checkpoints, direct executor custody/progress and a sorted current parent without repeated prose reconstruction. |
| Setup/local bridge, native plugins, hooks and session refresh | Install the right V3 instructions, remove stale restrictive hooks, qualify all claimed native routes, retain rollback and apply the Codex/Claude/OpenCode plus AG skills-only scope. |
| Tests, source contracts, docs, generated payloads and version metadata | Validate actual changed behaviour and integration; keep canonical/generated source and installed version consistent. |

Do not edit a generated managed block manually and leave its canonical source stale. Use existing generation/synchronisation commands and focused checks where appropriate. Preserve third-party licence and attribution. Package/version changes apply when implementation changes packaged runtime payloads; the preparation document is not a new installed product release.

## 18. V3 Core acceptance matrix

The release brief binds these criteria to exact sources, environments and evidence. No parallel compliance essay is required; a compact evidence-backed result for each is sufficient.

| Criterion | Demonstration required |
|---|---|
| Complete scoped outcome | One actual usable V3 workflow, including its approved host coverage, not isolated foundation completion. |
| Real discovery | Decisive repository, application, environment and installed-state observations used by strong G0; no phantom integration assumptions. |
| Strong roles | G0=G1 strong lead, preserved prior-G0 leaf bindings, default suitable G0/G1 delegation with substantial exceptions briefly recorded, actual launcher model/effort configuration, controller-only tier selection and G2 with no subagents. |
| Continuous delivery | G1 completes integration, meaningful validation and user UAT without mandatory mini-child gate dispatch. |
| Portable recovery | Fresh authorised consumers recover a completed prompt's source, state, evidence, authority and next action without prior chat history; include controller and harness switches through declared supported routes. |
| Programme truth | Existing children and approved obligations survive; category/release changes produce correctly sorted parent state without duplicating or dropping work. |
| Standing authority | Harmless real routine writes/transfers use the actual intended host path without unexpected repeated approval; genuine denials remain honest and bounded. |
| Private custody and retention | Producer uploads, verifies readback/recovery, performs eligible owned cleanup and returns a compact packet; referenced evidence remains available. |
| Source and installed authority | Candidate is tested in isolation, reviewed source is promoted deliberately, active instructions/hooks/version agree and a fresh session follows V3. |
| Native behaviour | Required actual host paths and relevant setup, cancellation, Windows, privacy and failure semantics are demonstrated; unavailable surfaces are visible. |
| Independent assurance | Fresh G2 covers original scope and genuine execution/security/evidence risks; blockers are fixed; optional expansion is excluded unless approved. |
| Finish and recovery | Authorised integration/install is read back, rollback is usable, current packet and programme position are accurate, later commitments remain owned. |

G2 passes source/behaviour applicable to the final candidate. After authorised activation, perform a narrow installed verification of that same candidate. If activation exposes a material defect or different payload, correct and review that difference. Do not call a source-only or test-only candidate the accepted installed product.

Required implementation and validation coverage includes focused synthetic positive and negative regressions for continuation at a resolved evidence gap without replay or consumption reset; reordered equivalent mappings and verified observers; unknown backend facts and finite alias uncertainty; and retained holds for overlap, target drift, active consumers, unsupported approval or unresolved effects. Success requires exact-target receipts and independent outcome readback. This is required coverage, not a completed or universal runtime claim.

### Cleanup and recovery fixtures

Exercise the following eleven cases through the implementation with controlled disposable fixtures and simulated time/approval/effect failures, never unsafe real deletions. Every case retains the source/checkpoint identity, exact request, observations, decision, permitted effect trace and independent result readback. Common prerequisites are verified target ownership/scope, required durable custody and consumer retrieval, applicable retention/holds, and valid authority. `ALLOW` means eligible within that authority, including any mandatory native approval; `HOLD` preserves the affected action pending a resolvable fact or permission; `REJECT` refuses the presented mismatched/out-of-scope request. No verdict broadens authority. Fixtures preserve prior consumption and denials.

| Case | Minimal required observations | Expected result | Permitted effects | Independent outcome oracle |
|---|---|---|---|---|
| 1. Unchanged valid evidence | Retained direct-use/mapping evidence still binds the exact target and consumer set; common prerequisites remain valid. | ALLOW eligible cleanup without a new global census or repeated approval. | Only the named disposable fixture target and retained-reference updates. | Fresh exact-target readback confirms removal; neighbour and retained-evidence identities are unchanged; trace has no unnecessary discovery replay. |
| 2. Reordered equivalent mapping | Same verified target/member identities and relationships as case 1, with only ordering changed. | Same ALLOW and effect set as case 1; no invented consumer/dependency. | Same eligible fixture operation. | Independent semantic mapping comparison and post-effect readback match case 1. |
| 3. Equivalent observer descriptors | Verified descriptors resolve to the same observation, target and consumer meaning; no material state changed. | Same decision as the baseline; ALLOW where baseline cleanup is eligible. | Baseline effect set only. | Independent descriptor/target equivalence check and readback show no extra protected or deleted target. |
| 4. Partial alias overlap | Exact affected overlap and independently proven disjoint eligible targets are known. | HOLD affected cleanup targets; ALLOW only proven-safe disjoint targets. | Bounded alias readback and eligible disjoint fixture cleanup. | Independent target map/readback proves overlap targets unchanged and only the disjoint eligible set removed. |
| 5. Unknown backend/alias facts | A fact material to destructive target identity, equivalence or isolation is unresolved. | HOLD affected destruction; reconsider only after sufficient exact identity/equivalence or disjointness evidence. | Targeted read-only resolution; independently safe work may continue. | Effect trace has no held mutation; an independent resolved-target readback supports any later release. |
| 6. New active consumer or target drift | A material refresh discovers active use or a mismatch from the identity bound by earlier eligibility. | HOLD active-consumer cleanup; REJECT the stale-identity request and reconcile current eligibility. | Read-only reconciliation and unaffected work. | Independent identity/consumer readback and effect trace show no stale-target or active-consumer deletion. |
| 7. Previously denied irreversible effect | Exact denied request and denial remain recorded; the actual supported approval path has not yet accepted the effect. | HOLD until that path accepts the exact applicable action. | Preserve the request and resolve approval through the supported mechanism; no duplicate effect attempt. | Approval-state readback and ordered call trace prove no effect before valid acceptance and no widened target. |
| 8. Ambiguous/interrupted deletion | Existing request/effect identity is known but completion is uncertain. | HOLD retry until actual outcome is established. If complete, record completion without replay; if unexecuted, reconsider only under still-valid prerequisites/authority. | Independent read-only reconciliation, then at most the required authorised outstanding effect. | Independent target readback and effect log establish actual completion and absence of duplicate effects; unresolved outcomes remain held. |
| 9. Completed deletion | Exact-target absence and retained evidence are independently verified; remaining references are identified. | ALLOW accurate completion/reference bookkeeping; no repeat deletion. | Update retained references/indexes within authority. | Independent target, neighbour and retained-store readback confirms the result; reports distinguish current-tree removal from Git-history or physical erasure. |
| 10. Eligibility-to-deletion race | In separate variants, inject a new active consumer, changed target identity or changed alias after the final eligibility check but before the real fixture cleanup operation. Observe the actual destructive boundary. | HOLD or REJECT the affected stale request; zero prohibited deletion. The unchanged eligible control still succeeds at the same boundary. | Only read-only reconciliation and independently safe effects; ownership/exclusivity may exclude unsafe concurrency, otherwise hold. | Independent target/consumer/alias readback and actual operation trace prove the intervening change reached the boundary and no prohibited target was deleted. A planner verdict or mock-only deletion is insufficient. |
| 11. Producer crash after custody | Durable upload and independent readback passed; producer stopped before eligible local temporary deletion; the existing checkpoint/manifest retains exact pending cleanup identity and evidence references. | Successor ALLOW only after fresh exact ownership/consumer/reference/authority checks, or HOLD the affected cleanup when one fails. No original producer session is required. | Reverify custody, reconcile any uncertain prior effect, clean only still-eligible disposable targets and update existing references. | A fresh successor recovers the pending action from retained state, independently verifies cleanup or its precise hold, and proves active worktree, sole-copy and retained-evidence preservation. Include an eligible positive and a newly active/reference-held negative. |

### Automatic successor qualification

Test the actual supported controller/launcher continuation path with a harmless authorised segment and consumer readback; controlled failure injection covers the negatives. Record checkpoint, segment, launch-request and worker identities, actual writer state, prompts and effect traces. A launch-request record alone does not prove that a successor consumed the packet or resumed work.

Include checkpoint-only save and failed-save controls: a changed-state save leaves the current executor running with no successor launch; a save/verification failure preserves source/evidence and holds dependent work for recovery without automatically launching a successor. An actual mandatory transfer instead verifies its checkpoint, quiesces the overlapping writer and follows the successor cases below. Distinguish failure to save a checkpoint from a successfully saved checkpoint containing a failing test.

| Case | Required observation and expected result |
|---|---|
| 1. Completed segment | Verified checkpoint, stopped old writer, satisfied dependencies and an already-authorised next segment cause exactly one successor to consume the checkpoint and continue without another owner prompt. |
| 2. Successor already active | A verified matching successor is reused; no additional writer or duplicate launch is admitted. |
| 3. Ambiguous launch result | Reconcile the original request with actual host/session state before retry. A found successor is reused; a proved unexecuted request may be retried within existing authority; unresolved ambiguity holds duplicate launch and is reported. |
| 4. Lost controller session | A fresh controller recovers durable checkpoint/launch/worker state and resumes the matching successor or permitted unstarted continuation without replaying consequential effects. |
| 5. Valid failing checkpoint | Preserve the failing test, consumed history and exact next hypothesis. Renew into authorised repair/validation when safe; do not manufacture milestone completion or advance work that depends on the failed condition. |
| 6. Genuine permission hold | No dependent launch/effect occurs until the supported permission path permits it. Record the precise hold and next action; continue independent authorised work without silent stalled status or repeated prompts. |

Independent readback must establish at most one active writer for the overlapping scope, faithful checkpoint consumption, and no repeated consequential effects in all six cases.

### Receiving-host qualification

Demonstrate one successful cross-host handoff: the receiving executor verifies section 7's source/delta, private evidence retrieval, required tools and exact target access; the controller/launcher verifies the native model/profile through supported launch configuration. Verify the applicable permission route on the receiving host, then complete a harmless already-authorised continuation using the recovered packet. Independently read back the launch configuration, receiver's consumed identities and result without requiring worker model introspection or self-admission.

Exercise one unavailable-capability negative on that path. The missing source, evidence, tool, route or permission holds its dependent work with a precise recovery action, while independently safe work remains possible. Verify no assumed transferred credentials/paths/binaries, no unsupported fallback or dependent effect, and no restart of completed product discovery. These tests qualify the demonstrated path only.

## 19. Dot's execution handoff

1. Read the owner's direct handoff, this exact V3 directive and the current parent Core plan. Resolve only changed or contradictory current evidence; avoid another chronology audit.
2. Check #461/#501/#455 actual worker/process state and #423's parked contribution. Stop new legacy dispatch, preserve each necessary checkpoint and establish a single writer for overlapping work. Continue independent preparation while a safe checkpoint is pending.
3. Adopt the scoped V3 transition and integrate the preparation source through the normal non-main branch/PR route. Do not delete global Toolkit installations or change other repos to make V3 start.
4. Run strong G0 against the actual environment. Bind the already-approved V3 scope, milestone order, native host coverage, custody, tests/UAT and authority. Ask only a real unresolved material question.
5. Launch one strong G1 Builder assignment for the complete Core. Let it continue across commits and fresh sessions using checkpoints; executors handle their own approved evidence/progress mechanics.
6. Obtain the working demonstration and user UAT, then run fresh G2 peers. Return only genuine blockers as one coherent correction assignment.
7. Complete the authorised merge/activation and installed proof, retain the recoverable packet and close only genuinely completed Core obligations. Reconcile remaining open work into the next proposed Core/Hardening/Later plan for user discussion.

Use the deadline to prioritise implementation and concrete proof. Do not add another redesign, prolonged record cleanup or automatic full review panel as a prerequisite to starting. Report product progress and the one next uncertainty that matters.

## 20. Provenance and current ownership

The owner approved the complete final execution clarification on 12 October 2026 and explicitly instructed dot to record and apply it in the original canonical contract. These amendments apply at the next safe renewal boundary within the same Toolkit Core assignment; they do not activate changes in unrelated projects. Preserve valid work, helper returns and evidence. No new programme child, discovery restart, recurring ceremony or extra spending is implied. Implementation and native qualification of the amended requirements remain evidence-backed acceptance obligations.

The owner's 12 October 2026 discussion provides this redesign direction and preparation authority. This directive intentionally amends the earlier [accepted Core design](https://github.com/weijunswj/ai-agent-toolkit/issues/461#issuecomment-6030806917) and [coordinated Core projection](https://github.com/weijunswj/ai-agent-toolkit/issues/421#issuecomment-6032480426), preserving their substantive product obligations except where explicitly revised above. The earlier [construction admission](https://github.com/weijunswj/ai-agent-toolkit/issues/461#issuecomment-6037517104) is source/effects history to reconcile at safe transition, not a permanent veto on the owner's new workflow. The prior role bindings are recorded in the [inspected stack registry](https://github.com/weijunswj/ai-agent-toolkit/blob/eed473bc5874781a795a29fb6c2b3d6632e9d047/repo/contracts/controller-kernel/stack-registry-v2.json); the table above is the V3 role mapping, not a claim that the registry has already changed.

Current product ownership remains in #421 and its existing children. This document is the canonical V3 transition and target contract; the parent is its current delivery projection. During implementation, convert the active canonical instructions to the V3 contract and retire contradictory transitional wording. Do not leave two competing permanent controllers.
