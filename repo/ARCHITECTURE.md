# Toolkit Architecture

## Purpose and authority

This document defines the stable high-level architecture of Toolkit itself.

Toolkit-managed repositories use Toolkit governance, but they do **not** inherit this repository's internal product architecture. A target repository follows its own current architecture, Design Locks and explicit owner authority.

Toolkit implementation, controller behaviour and programme structure must conform to this document unless explicit User/Web architecture authority amends it.

Historical issues, comments, runs and migration shells are evidence and chronology. They do not silently redefine this architecture.

## North star

Toolkit exists to minimise:

- model token and context consumption;
- orchestration and controller churn;
- repeated model invocations;
- unnecessary human intervention;
- delivery latency;

while maintaining high coding quality, safety, correctness, recoverability and truthful authority.

Governance is a means to those outcomes, not an end in itself. New machinery must provide material value that cannot be achieved more simply by an existing mechanism.

Normal model-visible context must scale with **current work**, not repository age.

## Delivery topology

The normal governed delivery shape is:

```text
Programme
  -> optional Stage grouping
       -> bounded Delivery Child
            -> one normal Delivery PR
```

Definitions:

- **Programme** — objective, required outcomes, child membership, dependencies, authorised concurrency and programme finality.
- **Stage** — optional planning/navigation grouping. It is not another executable gate hierarchy.
- **Delivery Child** — the normal governed shipping unit and gate boundary.
- **Delivery PR** — the child's normal public integration candidate.
- **Execution** — one bounded attempt at an admitted role/task.
- **Acceptance task** — UAT, verification or audit work that does not itself need a source PR.

Delivery children remain flat under the programme. Do not create recursive executable topology merely because a stage is large.

### Human programme surface

Toolkit-managed GitHub programme and Delivery-Child bodies are deterministic human-facing projections of canonical programme/child state. Do not manually maintain or hand-rewrite a managed projection as an independent authority surface. Change the canonical state/contract or authorised renderer, regenerate, and read back the managed surface. Owner-controlled text explicitly outside a managed region may remain directly maintained where the governing contract permits it.

Presentation structure, title prefixes, display ordering/numbering and wording conventions belong to the authorised renderer/schema and its regression tests unless an explicit architecture decision makes a field semantically authoritative. They are not architecture law by default.

Generated surfaces must preserve canonical programme/child identities. Presentation metadata must not introduce a second authority identity or an ambiguous parallel numbering scheme. Supporting/investigation/acceptance sub-issues use their native relationships; their exact human-facing title format is a renderer concern.

### Supporting sub-issues and labels

A Delivery Child may contain nested GitHub sub-issues for bounded **supporting work** such as investigation, evidence gathering, migration proof, UAT or acceptance tasks.

Supporting sub-issues do not automatically acquire their own Delivery PR, G1-G4 lifecycle, correction budget, ownership/finality authority or merge boundary. If supporting work becomes independently shippable, independently reversible, or requires its own material architecture/authority decision, promote it to a separate flat Delivery Child instead of deepening the executable hierarchy.

Use native issue relationships by meaning:

- parent/sub-issue = decomposition or belongs-to;
- blocked-by/blocking = dependency or ordering;
- Delivery PR = integration candidate for the Delivery Child.

Labels are lightweight discovery/filtering metadata only. They may describe type, stage/domain or visibility state, but they do not grant ownership, authority, gate status, completion or finality. Prefer a small stable label vocabulary over encoding process history in labels.

Epoch may survive as a historical/grouping term, but must not create another independent gate lifecycle.

Root is a diagnostic/root-cause identity where useful, not an executable programme layer.

## Normal child invariant

A bounded Delivery Child normally has:

- one coherent user or system outcome;
- one current accepted architecture and implementation contract;
- one understandable invariant/dependency boundary;
- one normal public Delivery PR;
- one independently reviewable G4 scope;
- one clear integration and reversal boundary.

Multiple commits, tests and internal worker operations may occur during G3 and converge into the same Delivery PR.

If an increment deserves its own independent merge and reversal boundary, it normally deserves its own Delivery Child.

A technically necessary replacement PR may preserve the same child only when identity, evidence and correction accounting remain continuous. Replacement never resets correction budget.

## Stage topology and stack routing

Governance stage semantics are provider/model agnostic.

- `G_FRAME` = optional bounded problem framing; leaf-only, read-only and non-gating, used only when the causal/evidence question is not already sufficiently framed.
- `G0` = bounded evidence acquisition/investigation; non-gating and subagent-capable for bounded read-only discovery.
- `G1` = root convergence plus architecture/authority.
- `G2` = adversarial executable implementation-contract closure.
- `G3` = implementation/validation.
- `G4` = fresh isolated exact-head independent assurance.
- `G1_RECONVERGENCE`, `FINAL_AUDIT` and `BROWSER` are named execution roles outside the G1-G4 decision sequence. G1_RECONVERGENCE is read-only and non-gating and uses exactly the selected stack's G1 provider/model/reasoning route.

Only G0 and G3 may use semantic depth-1 subagents. All spawned subagents are leaf-only. G0 fan-out is read-only evidence acquisition; G3 fan-out must remain inside the accepted G2 separation/mutation contract.

Concrete provider/model/reasoning choices are selected through an explicitly named stack registry binding and are configuration, not architecture law. There is no authoritative default stack. Stack selection and physical harness selection are orthogonal. Root model/route selection is an out-of-band User/Web/controller/harness act performed before root launch/adoption; the root semantic worker never verifies or attests its own model identity and cannot HOLD because runtime model metadata is absent. A genuine root-route handoff is therefore a pre-launch orchestration decision when the selected route cannot actually be established, not a worker self-check. One logical lane may hand off between qualified harnesses without changing semantic gate identity, RUN/Lock, ownership, correction accounting or candidate identity. Service treatment/speed is non-authoritative observed metadata. A route or harness change that preserves these stage semantics and authority boundaries does not require an architecture redesign.

Web may also issue an evidence-backed `WEB_ROUTE_RECOMMENDATION` when current-run evidence shows the selected route may be materially too light for the accepted stage. The recommendation has no authority effect. An exact provider/model/reasoning override may be applied only after explicit Owner approval, only for the recorded RUN + stage/episode scope, and only at a safe worker launch/adoption/replacement boundary. Preserve the named stack and registry revision as baseline provenance plus the approval receipt and exact override. This is a bounded orchestration overlay, not a new stack, fallback chain or semantic escalation stage. It never changes gate authority, scope, candidate allowance, correction accounting or re-entry obligations.

Parallelism is optional rather than a topology obligation. Programme lanes may progress concurrently in different harnesses, and G0/G3 may fan out only when work is genuinely separable and the expected latency/usage benefit justifies orchestration overhead. When G0/G3 launches a semantic child, the parent/launcher resolves the concrete child route from the selected stack and supplies the model/reasoning configuration to the harness before child creation. Root and child semantic prompts do not own model names, and spawned children never self-attest after launch. Semantic executors consume bounded stage/task authority and the smallest relevant repository instruction surface; the full Controller is control-plane source material and is not a default worker prerequisite.

## Governance cutover for active lineages

A still-required lineage may outlive the Controller revision under which it began. At the next safe terminal/reconciliation boundary, compatible stricter current governance is adopted prospectively for the continuing lineage. This preserves the same Delivery Child/root-family/continuation identity, consumed budgets/attempts, historical candidates/evidence and original gate outcomes. In-flight workers are never silently rewritten, and newer governance does not itself reopen accepted architecture or implementation contract. A genuine semantic conflict returns to the responsible G1/G2/Owner boundary.

Before a disposable execution surface is destroyed after material construction or validation, any candidate/evidence required by a later gate or controller must already be durably retrievable or deterministically reproducible and bound to the continuing RUN/Lock/candidate identity. Teardown cannot be used as an implicit evidence-retention policy.

## Gate lifecycle

### G0 — Problem framing and evidence acquisition

G_FRAME is an optional pre-G0 read-only framing role, not a phase that must run for every investigation. It frames uncertain/diagnostic work when User/Web/current evidence has not already supplied sufficient causal framing: known facts, contradictions, material unknowns, competing hypotheses, discriminating evidence questions and the stopping condition for sufficient evidence. G_FRAME is leaf-only and grants no G1 architecture authority.

G0 is the non-gating evidence-acquisition/investigation stage. It consumes an accepted G_FRAME packet or sufficiently specific framing already supplied by User/Web/current evidence and may fan out bounded depth-1 read-only leaves for genuinely separable questions. Leaves collect evidence rather than independently redesigning the solution. G0 may be omitted when existing evidence is already sufficient for the next required decision.

When a known-good qualified path succeeds while the real production path fails, G_FRAME first records the material differential between them, including the known-good upper-bound positive control and the real production entry point. G0 then prefers one bounded differential experiment that starts from the known-good state and varies/minimises the material differences systematically while exercising that production entry point. Serial symptom-by-symptom probes are a fallback only when an earlier boundary genuinely prevents deeper observation in the same safe experiment. Incidental environment/check/transport failures do not become the new root model when a deterministic authorised carrier can still answer the original differential question.

### G1 — Root convergence, architecture and authority

For material uncertain work, G1 establishes:

- outcome and scope;
- a supported bounded causal/root model explaining the material observations;
- material competing hypotheses and their disposition;
- governing invariant and trust/authority ordering;
- materially equivalent surfaces inside the defect/risk class;
- where a logical identity controls lifecycle/coordination and maps to a consequential external resource, whether distinct accepted logical identities can address the same underlying resource and therefore require one resource-equivalence identity or explicit alias semantics;
- architecture and authority boundaries;
- risk/assurance path;
- dependencies;
- child sizing and whether work must split;
- remaining assumptions and evidence that would invalidate them.

Material unresolved root uncertainty produces HOLD with a specific missing-evidence request rather than a speculative PASS.

Toolkit G1 must prove conformance to this document or explicitly obtain authority to amend it.

### G2 — Adversarial executable implementation contract

G2 independently challenges the accepted G1 boundary before mutation. It may inspect primary sources and reject a flawed G1 assumption.

One admitted same-root G2 episode owns its own read-only contract convergence. It performs bounded `challenge -> refine -> challenge` over the proposed enforcement mechanism/completeness proof, state machine, protocol/schema, recovery behavior, evidence/validation contract and mutation/candidate boundary. Discovering a defect in that proposed contract is not itself a terminal AMEND and does not justify a fresh same-root G2 identity while root/trust/Owner decisions, evidence sufficiency and authorised scope remain unchanged.

G2 terminates as `G2_PASS`, genuine evidence/environment `G2_HOLD`, `G2_REENTRY_REQUIRED` for changed root/trust/Owner/upstream semantics, or `G2_NONCONVERGED`. A `G2_NONCONVERGED` packet names the surviving contradiction, challenged alternatives and smallest missing decision/evidence boundary and returns to Web. Renaming RUN/Lock without materially changed input does not create another admissible G2 episode.

G2 binds:

- acceptance criteria and invariants;
- consequential entry/copy/serialization/consumer boundaries;
- affected consumers;
- permitted and forbidden behaviour;
- positive, negative and adversarial regression oracles;
- causal negative-control requirements that prove the named production actor caused the consequential observation rather than test instrumentation manufacturing it;
- async/liveness and deferred-work accounting requirements when drains/waits/flushes/queues/completion trackers or equivalent boundaries are material;
- for each material stateful/async transition, a named deterministic negative transition regression plus positive control, covering the interruption/replacement/cancellation/late-completion windows that are actually relevant to the state machine;
- when validation cases share a materially bounded/mutable resource, the resource/equivalence identity, material capacity/window/state semantics, per-case consumption/mutation, later-oracle prerequisite state and one explicit non-interference strategy; prefer faithful isolation, then deterministic reset, then explicit shared-state ordering/ownership, using bounded pacing/window separation only when the real accepted resource is inherently time-windowed and cannot be safely isolated/reset;
- for universal/arbitrary/unknown-behaviour invariants, the concrete enforcement mechanism plus a completeness argument under the actual language/runtime model, including what state/events are observable and which material paths bypass any finite observer;
- for universal/arbitrary/no-bypass/complete-provenance claims, a `MECHANISM_COMPLETENESS_PROOF_MODEL` containing: (a) complete trusted-boundary inventory across executable ingress/egress, exported/callable aliases, receipt producers/consumers, parsers/serializers and binding/admission paths; (b) a material state-machine artefact naming states, transitions, actors/roles, transition authority, duplicate/retry/replacement rules, terminal states and consequential effects; (c) a protocol-schema artefact binding accepted receipt/message/evidence shapes, cardinality, multiplicity, cross-message identities and malformed/unknown-field behaviour; (d) enforcement mapping from every model edge/state/schema obligation to concrete trusted enforcement and production-boundary evidence; and (e) explicit falsifiable runtime/language/provider assumptions. Existing canonical schemas may be referenced rather than duplicated when complete;
- one complete current-requirement coverage manifest: every mandatory acceptance criterion, inherited blocker/defect family and still-required obligation has exactly one disposition (`IMPLEMENT_IN_THIS_CANDIDATE`, `ALREADY_SATISFIED_WITH_EXACT_EVIDENCE`, `UNCHANGED_REQUIRED_CONSUMER`, or `OUT_OF_SCOPE_WITH_EXPLICIT_CONTINUING_OWNER`), and every implemented row maps requirement -> invariant -> consequential boundary -> affected consumers/surfaces -> negative regression -> positive control -> G3 executable proof -> G4 assurance surface;
- for one-screened-boundary/no-bypass claims, a callable-surface inventory covering exported aliases and materially reachable alternate routes, with every public/reachable path bound to the accepted enforcement and internal-only paths explicit;
- for backward/readback/serialization compatibility, immutable predecessor-produced bytes/artifacts from an exact accepted producer revision consumed unchanged by the candidate, rather than candidate-regenerated approximations;
- for semantically equivalent input/state representations, the canonicalisation rule applied before identity/digest/hash/signature and the equivalence regressions that prove identical canonical identity;
- where rejection promises zero user-controlled execution or side effects, the material language/runtime hooks reachable before rejection and the instrumentation proving zero prohibited execution at the real boundary;

For transactional/state-machine work, relevant windows commonly include pre-commit, partial commit, cleanup, and retry after interruption. For async work they commonly include pre-wait, during-wait, replacement/cancellation, late arrival, and completion after a snapshot/decision point. G2 selects the windows that can materially violate the accepted invariant; this is not a mandatory combinatorial matrix.

Validation itself must not manufacture a false candidate failure by perturbing a prerequisite resource used by a later oracle. Examples include rate-limit/quota windows, shared session state, queues, caches, database fixtures/counters, exclusive leases/locks, ports/sockets, provider/API quotas and finite test identities. Isolation/reset must remain faithful to production semantics; do not rotate/spoof identities, disable limits or reset production state in a way that bypasses the invariant. Where the resource is genuinely time-windowed and no faithful isolation/reset exists, use one explicit bounded group/window boundary with attributable evidence rather than scattered sleeps. If the shared interference is itself the behavior under test, declare that intentionally instead of suppressing it. Proven validation self-interference is harness/evidence failure rather than product failure absent separate candidate-defect evidence.

A complete contract is also distinct from a green subset of tests: omission of a still-required criterion/defect family is a contract-coverage failure, even when every implemented row passes. A safe wrapper cannot establish a no-bypass public-boundary claim while another exported/reachable route avoids it. Compatibility is proven with predecessor-produced artifacts, not by regenerating historical-looking bytes with candidate code. Canonical identity is computed only after accepted representation equivalence is normalised. A rejection oracle that requires noninterference observes side effects/hooks before the rejection point; the final error code alone cannot prove zero execution.

Mechanism completeness is distinct from semantic correctness. A finite denylist, observer, hook, lexical brand, parser route, intercepted API or event list cannot implement a universal `any/arbitrary/unknown` invariant unless the runtime model proves that mechanism sees every relevant violating path. If the platform cannot generically introspect the required state after arbitrary/untrusted code has acted, G2 must move enforcement to a complete trusted boundary: invalidate or expire provenance at exposure, copy/normalise into trusted state, re-establish trust after the boundary, or return to G1/Owner when the trust model itself must change. Post-hoc detector coverage is not a substitute for observability the platform does not provide.

A dense finite regression matrix remains necessary falsification/implementation evidence but is not a completeness proof. For an exhaustive claim, the proof model must explain why the trusted boundary is finite and exhaustive and must distinguish materially different execution identities (for example coordinator versus actual executor) when substitution would change the guarantee. State-machine and protocol-schema artefacts may be embedded in an existing canonical contract/IR/schema when that representation is complete; do not manufacture duplicate documentation. G4 directly challenges the proof model by seeking an executable route, multiplicity/replay/reordering, malformed child evidence, identity substitution or state transition absent from the model. A successful such counterexample is `MECHANISM_COMPLETENESS_UNPROVEN` unless it is demonstrably an ordinary implementation defect already inside an accepted complete model.
- validation and evidence requirements;
- reversal/recovery behaviour;
- correction limits.

For material difficult/diagnostic/security/authority-sensitive work, G2 should use a fresh context and ask how an implementation could satisfy the proposed instructions while still violate the accepted invariant.

For expressly simple/low-uncertainty work, one invocation may establish logically separate G1 and G2 decisions when current routing/authority permits it; record the absence of a fresh independent-model challenge.

### G3 — Implementation and validation

G3 implements and validates the complete bounded child candidate within the accepted contract and demonstrates closure at actual consequential/public boundaries, not only helper-level tests.

A repository validator may itself require immutable commit identity or a clean committed working tree. When G2/G3 explicitly binds `COMMIT_REQUIRED_VALIDATION=YES`, run all meaningful checks that do not require commit identity first; after they pass and candidate contents/scope are frozen, create the ordinary immutable local candidate commit under the existing allowance and bind its commit/tree/parent. That candidate identity is byte-stable: do not amend, rebase or reconstruct it. Run the identity/clean-tree-dependent and remaining floor against that exact commit, and publish only after the complete floor passes. The local commit is construction/custody, not a separate G4 lifecycle or publication event. Candidate/product failure returns through normal correction/re-entry; environment/transport/evidence failure preserves the exact commit. A later distinct replacement candidate in the same G3 episode is permitted only under the bounded hosted non-product reclosure rule below and never rewrites this candidate.

For stateful/async work, G3 PASS includes an invariant-to-regression map: every material G2 invariant names the executable regression or production-boundary check that proves it, including the relevant transition/interruption case. Aggregate suite-green status cannot substitute for this mapping.

Ordinary implementation choices inside the contract remain G3 work. A discovery that changes the governing invariant, trust boundary or material contract HOLDs for the appropriate re-entry.

Candidate immutability is per exact candidate identity, not a requirement that the entire G3 episode contain only one candidate. After a published/hosted candidate fails required validation, Web may keep the same RUN/Lock/G3 episode and authorise a distinct immutable replacement candidate only after causal ownership is established as HARNESS, TOOLKIT or ENVIRONMENT with `PRODUCT_SEMANTICS_PROVEN_BAD=NO`, while product semantics, root/trust, accepted G2 contract and assurance floor remain unchanged. The correction must be bounded to the exact validation/harness/tooling/environment mechanism. Every failed candidate remains immutable durable evidence; every replacement gets a new commit/tree identity and exact revalidation boundary. This is validation reclosure, not product correction: it consumes no product/G3 correction attempt and resets no budget. Product RED stays in ordinary G3 convergence; contract changes return G2; root/trust changes return G1. Repeating materially equivalent non-product RED without improved causal evidence returns to Web diagnosis rather than candidate churn.

For sufficiently complex/STRICT work involving concurrency, async completion, deferred consequential work, causal negative controls, lifecycle coordination or identity/resource equivalence, G3 performs a pre-publication adversarial validation episode inside the same G3. When separable and useful this may use one depth-1 read-only validation leaf; otherwise the parent performs it serially. The challenge tries to falsify the regression oracle, causal attribution, liveness/progress, outstanding-work accounting, resource-equivalence handling and false-green controls. It is not another gate: the parent remains sole integrator, ordinary RED stays inside G3, missing product/compatibility semantics return to G2, and changed root/trust/architecture returns to G1.

Async validation for a changed drain/wait/flush/join/poll/quiesce/retry/completion boundary includes a waiter-first control where required completion occurs later and depends on event-loop/I/O/timer/callback progress. Required deferred work remains outstanding from scheduling through consequential completion; clearing its scheduling primitive is not completion. Flush semantics either permit the normal dispatch or take ownership of the same work and complete it through the normal consequential path.

Ordinary commits or internal increments do not create separate G4 lifecycles.

Material scope expansion stops the affected work at a safe boundary and returns to Web for amend/split/replan authority.

### G4 — Child-final independent assurance

G4 is fresh, isolated, read-only assurance of the **complete final Delivery Child candidate** and its relevant dependency boundaries/evidence.

G4 remains adversarial; upstream convergence must improve first-pass quality without weakening G4.

For every material detector/interceptor/hook/brand/parser/ledger enforcement mechanism, G4 challenges mechanism independence where materially plausible: vary how the same forbidden semantic state is produced, not only the input value. At least one adversarial equivalent should avoid the candidate's observer entirely (for example a different lexical identity, ordinary construction instead of an intercepted API, or a state change that leaves watched shape/prototype evidence unchanged). If an equivalent violating path can bypass the observer, classify `MECHANISM_COMPLETENESS_UNPROVEN` and return to targeted G2 before another G3.

A material G4 finding may record one primary learning classification: `G1_ROOT_MODEL_MISS`, `G2_CONTRACT_COVERAGE_MISS`, `MECHANISM_COMPLETENESS_UNPROVEN`, `G3_IMPLEMENTATION_MISS`, or `G4_NOVEL_EDGE_CASE`. `MECHANISM_COMPLETENESS_UNPROVEN` means the accepted semantics may be correct but the enforcement/observability proof is incomplete; it requires targeted G2 before another G3. Classification is diagnostic evidence, not a score or authority grant.

Blocking findings also carry causal ownership independent of that learning classification:

- `OWNER=PRODUCT`: the candidate/product itself is proven to violate an accepted invariant through a valid evidence path; only this ownership supports `PRODUCT_SEMANTICS_PROVEN_BAD=YES` and product/G3 correction attribution.
- `OWNER=CONTRACT`: G2 contract, proof model, completeness boundary, acceptance criterion or executable evidence contract is missing/incorrect.
- `OWNER=TOOLKIT`: reusable Toolkit governance/runtime/control-plane machinery is defective independently of the target product semantics.
- `OWNER=HARNESS`: verifier, test runner, launcher, host integration or equivalent evidence machinery is defective.
- `OWNER=ENVIRONMENT`: provider, transport, capability, runtime or validation environment prevents trustworthy evidence without proving the product bad.
- `OWNER=UNKNOWN`: causal ownership is not yet established; remain blocked where required and run bounded diagnosis rather than mutating the candidate speculatively.

Every blocking receipt records `PRODUCT_SEMANTICS_PROVEN_BAD=YES|NO`. Until candidate semantics are independently shown bad, the value is NO. A finding may retain secondary durable defect ownership, but one smallest primary causal owner drives immediate routing/correction accounting so product convergence and delivery-machinery convergence remain distinguishable.

A known-broken canonical verifier may be replaced by bounded equivalent evidence only when the verifier is evidence machinery rather than itself an unresolved required shipped/product/security/finality outcome. The substitute must preserve the accepted invariant unchanged, exercise the same consequential production boundary or a proven faithful equivalent, reproduce the required positive/negative/adversarial and effect/zero-effect semantics, bind exact candidate/evidence provenance, and receive normal independent assurance. Successful substitute evidence may establish product correctness and allow product delivery to continue, while the verifier/Toolkit/harness defect remains separately owned and unresolved. If equivalent evidence cannot establish product correctness, the state remains a validation/evidence block with product semantics not proven bad.

G4 is not an automatic review of every commit or internal increment.

Web retains merge and child-finality authority after exact candidate, base, checks, findings, authority and required evidence are reconciled.

### G1 re-convergence

G1_RECONVERGENCE is a read-only, leaf-only, non-gating G1-class root-model reconsideration/synthesis role that Web may invoke after bounded focused recovery fails to converge at the same/root-related boundary. It is not invoked automatically merely to avoid Web adjudication.

Its result is `CONTINUE_CURRENT_CONTRACT`, `G2_REENTRY_REQUIRED`, `G1_REENTRY_REQUIRED`, `OWNER_DECISION_REQUIRED`, or `NONCONVERGED`. It grants no authority. `CONTINUE_CURRENT_CONTRACT` is actionable only when existing authority and fresh state already permit the named work; `NONCONVERGED` remains an Owner/Web decision state.

## Child sizing and splitting

G3 should begin only when a fresh reviewer can understand, implement, validate and independently assure the child within its allocated context and execution budget.

Split during G1/G2 when:

- outcomes can ship independently;
- authority/trust boundaries require different acceptance;
- there are distinct integration/reversal boundaries;
- the combined candidate would require substantial unrelated history to understand;
- assurance cannot coherently review the whole candidate.

Do not split only by file count.

Do not split tightly coupled safety invariants merely to create smaller PRs.

Prefer flat descriptive sibling children. Avoid recursive names/topology such as `S2B1A2`.

## Assurance paths

- **LIGHT administrative** — authorised deterministic operation plus verified readback; no artificial G1–G4 ceremony.
- **LIGHT low-risk mutation** — focused contract and validation; independent G4 only when specifically required.
- **ASSURED delivery** — bounded Delivery Child lifecycle with child-final G4.
- **STRICT delivery** — the same lifecycle plus explicit trust/authority boundaries, adversarial evidence and only specifically justified intermediate independent checkpoints.

An intermediate checkpoint must name the consequential operation and explain why waiting for child-final G4 is unsafe. It does not become another ordinary G4 lifecycle.

If an intermediate source integration is independently shippable, prefer another Delivery Child.

## G4 failure and correction

Classify findings before continuing:

- bounded implementation defect within accepted contract -> correct in the same child/PR when correction budget remains, rerun affected validation, then fresh G4;
- executable-contract defect with architecture intact -> re-enter affected G2;
- root-model, architecture, authority or child-boundary defect -> hold and re-enter G1/replan/split;
- provider, route, authentication, check-system or evidence-availability problem -> typed HOLD, not an implementation correction;
- non-blocking improvement -> retain one durable continuing owner without prolonging a safe candidate.

Retain at most two ordinary material correction attempts per implementation lineage.

One ordinary correction attempt is a coherent correction batch following an accepted material verdict, not each finding, commit or test run.

Before returning to G4, inspect materially equivalent paths and retain semantic regressions for the accepted defect family.

Renaming a child, branch, PR, contract, hypothesis or lineage label does not reset exhausted work.

### Reconverged correction exception

After an implementation lineage is `2/2_EXHAUSTED`, Owner/Web may explicitly reserve **at most one** `RECONVERGED_CORRECTION` for the same continuing scope. This is an exception to the ordinary correction ceiling, not a Repair 3 and not a fresh lineage.

Admission requires all of:

- the exhausted history remains explicit and continuous;
- fresh root synthesis explains why the earlier corrections failed and states the supported governing invariant;
- concrete counterexamples plus a boundary-to-regression/evidence map demonstrate what prior implementation/tests missed;
- fresh G2 adversarial closure is accepted before mutation;
- Owner/Web separately grants the exceptional implementation after G2;
- the exceptional episode has fixed scope and whole-episode authority, may resume after interruption, and may submit exactly one candidate to fresh exact-head G4;
- normal validation/CI/G4 standards are unchanged;
- the reservation survives renamed branches/PRs/children/contracts and cannot be renewed for the same continuing correction scope.

A material rejection of that exceptional G4 candidate ends autonomous same-scope correction. No further repair, reconverged exception, manufactured lineage or replacement child follows automatically.

### Web-directed continuation after autonomous exhaustion

Autonomous correction limits bound model-driven retry loops; they do not make unresolved required work impossible to finish. After ordinary corrections and any permitted reconverged exception are exhausted, the existing child returns to Owner/Web.

Owner/Web may explicitly grant a `WEB_DIRECTED_CONTINUATION` for the same continuing child and scope when a fresh accepted G2 contract deterministically binds the remaining implementation boundary. The grant:

- preserves the exhausted `2/2` history and any consumed reconverged exception;
- is not Repair 3, a new implementation lineage, a fresh budget or a replacement child;
- names the exact current base, mutation/carry/preserve boundary, validation floor and candidate construction;
- authorises at most one bounded implementation candidate and its required fresh exact-head G4;
- gives no automatic follow-on authority after a material G4 result;
- returns any material ambiguity, scope expansion or G4 AMEND to Owner/Web.

This is an explicit human/Web authority path, not an autonomous retry mechanism. It therefore does not require inventing a material architecture boundary merely to continue required same-scope work.

### Delivery Child lifecycle and non-convergence

A Delivery Child is the durable owner of its admitted outcome until one of two explicit terminal dispositions occurs:

- **completed** — its required acceptance/finality has been achieved and its terminal disposition is durably recorded; or
- **superseded/retired by Owner/Web** — an explicit current Owner/Web decision changes the child topology/lifecycle and identifies the durable continuing owner for every still-required obligation.

Normal execution events do not imply either disposition. In particular, worker failure/replacement, HOLD, G4 AMEND, route/provider/evidence blockage, implementation non-convergence, or exhaustion of the current implementation-lineage correction budget must leave the existing child open/current or held unless Owner/Web explicitly decides otherwise.

Correction-budget exhaustion remains visible and terminal for the ordinary correction allowance of that implementation lineage. It requires Owner/Web adjudication. A new implementation lineage or new flat Delivery Child is valid only when justified by a material architecture/authority or independently shippable/reversible boundary and explicitly accepted; it must never be created merely to reset correction accounting. The bounded reconverged-correction exception is the final autonomous same-scope exception. A later same-scope `WEB_DIRECTED_CONTINUATION` is possible only through a new explicit Owner/Web grant under the section above and never resets the exhausted accounting.

Bounded-convergence rules govern executor persistence inside the existing child without requiring an automatic separate reconvergence referee. After one focused diagnosis/recovery, repeated same/root-related HOLD returns to Web with bounded evidence. Web may optionally invoke one read-only Re-convergence synthesis; that synthesis cannot close/retire/supersede/replace/transfer the child or reset/expand correction or mutation budgets.

## Roles

- **User/Web** — architecture, material scope/risk/authority changes, topology decisions, waivers, consequential authority and finality.
- **Worker/executor** — implementation or bounded analysis; no ownership/finality authority.
- **Deterministic runtime** — state, admission, routing, identity, recovery, publication/readback and safety enforcement.

## Context and token architecture

Always-loaded information must remain small.

- **Custom Instructions** — discovery bootstrap only: retrieve/verify canonical Toolkit controller governance.
- **CONTROLLER.md** — compact controller kernel/router: authority, current-state protocol, delivery/gate semantics, safety invariants and deterministic contract routing.
- **Cold-path contracts** — detailed rules loaded only when operation/effect type requires them.
- **Programme projection** — current children, relevant dependencies/holds, authority pointers and next admissible actions.
- **Child contract** — current outcome, scope, invariants, authority, candidate and relevant evidence references.
- **Worker packet** — exact task, allowed effects, required rules and necessary current pointers.
- **G4 packet** — exact child acceptance scope, candidate/base binding, relevant findings and evidence index.
- **Chronology/history** — retrieved lazily by exact reference only when a current decision requires it.

Bootstrap/restart is current-state reconstruction, not chronology replay.

Adding completed children or historical comments must not enlarge ordinary takeover/worker context when current state is unchanged.

## Evidence and terminal decisions

Durability must not require repeatedly copying large evidence through model-visible handoffs.

The target terminal shape is:

- compact typed decision record containing every material finding, qualification, unresolved risk, disposition, exact identity and other fact needed for the receiving Web/assurance decision;
- immutable evidence manifest containing identity, binding, custody/retrieval information and required consumers;
- supporting evidence retained under the authorised policy, with external retrieval used only where the accepted contract guarantees access by the intended consumer.

A producer must not assume that Web or another later consumer has its filesystem, shell, session/process state, hidden logs, host-only tools, or independent ability to refetch/recompute missing facts. Decision-relevant content required for immediate adjudication travels in the terminal packet. Pointers and retrieval instructions are supplementary, not substitutes.

If required supporting evidence cannot be durably and verifiably retrieved by the intended consumer, deliver the relevant material with the packet/authorised attachment or hold with `EVIDENCE_NOT_RETRIEVABLE`.

Retained, retrievable, delivered and consumed are distinct states.

A digest, inaccessible pointer or synopsis alone is not proof of evidence availability.

Consumers must verify exact identity/applicability before relying on retrieved evidence.

## Programme-state ownership

The programme parent owns programme-level truth only:

- programme identity/objective;
- registered children and order/lifecycle;
- dependencies and authorised concurrency;
- programme-wide holds;
- terminal child dispositions;
- deferred-work ownership relationship;
- programme finality.

Each Delivery Child owns its operational truth:

- current contract;
- candidate;
- gate/execution state;
- correction accounting;
- evidence pointers;
- holds;
- next admissible action;
- the bounded material live operational identities required to safely execute that current/next action, with authoritative provenance or deterministic derivation.

CURRENT is an operational projection, not merely a gate projection. It must be complete enough to name and touch the correct live repository/external targets for the next admissible action without consulting stale chronology. Repository-specific identities remain bounded to the active lane; Toolkit does not require a global configuration registry.

For mutable live identity, reconciliation is field-level and semantic. Explicit Owner/Web authority and the owned CURRENT projection outrank historical reporting; exact controlling receipts and fresh provider/repository reads support CURRENT where applicable. Historical receipts remain immutable evidence but never silently become current authority because CURRENT omitted a field.

An accepted change to a material live identity must update/read back CURRENT before consequential progression. Missing, stale, contradictory or unverifiable action-required identity is `CURRENT_PROJECTION_INCOMPLETE`, not permission to infer from comments, examples, fixtures, caches, memory or prior worker packets.

Child-local transitions should not churn the parent.

Deferred material work keeps exactly one durable continuing owner without becoming mandatory current implementation scope.

## Anti-drift invariants

Toolkit must not:

- make G4 per-commit or per-internal-increment by default;
- create mega-children and compensate with nested Epoch/Root/PR gate loops;
- replay programme history during ordinary takeover;
- duplicate operational governance into Custom Instructions;
- treat historical comments as current policy merely because they exist;
- reset exhausted work by renaming its container;
- add new agents, ledgers, registries or coordination layers when existing deterministic machinery is sufficient;
- optimise apparent speed by weakening safety, correctness, authority or evidence integrity.

## Conformance and measurement

Toolkit architecture changes require explicit User/Web architecture authority.

Every material Toolkit G1 must check its proposal against this document.

The final whole-programme audit must independently verify the retained Toolkit implementation conforms to this document.

Toolkit should measure, where available:

- takeover and worker input size;
- model calls and controller turns per accepted outcome;
- activation-to-merge time;
- repair/G4 churn;
- current-work versus historical/governance context;
- unique material defects found by assurance;
- avoided model invocations;
- recovery cost after interruption.

Missing telemetry is `unavailable`, never inferred.

Success means lower context/invocation overhead and delivery time on comparable work without weakening accepted safety/correctness evidence.
