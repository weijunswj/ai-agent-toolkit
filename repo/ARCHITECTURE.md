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

### Programme discovery basis

`DISCOVERY_BASIS=REUSE|DELTA|FULL|ADOPTED_EQUIVALENT` records admission/applicability for the consuming child. It is a fact and receipt, not a new gate, role, task queue, or architecture authority. A new chat, day, worker, takeover, or task does not by itself justify `FULL`.

- `REUSE` applies when the exact existing findings remain applicable. The child records a bounded applicability receipt bound to the exact consuming repository, programme, child revision and baseline revision, with baseline/finding identities, checked dependencies and invalidation triggers; a receipt cannot be replayed across consumers, and it does no dedicated discovery work just to restate unchanged evidence.
- `DELTA` is the default for changed or new material facts in the consuming child. Invalidate only findings whose dependencies or triggers changed; unrelated findings remain reusable.
- `ADOPTED_EQUIVALENT` names adequate existing investigation by exact source, revision, and evidence identity, but is admitted only by a current applicability readback bound to the consuming repository, programme, child revision, baseline revision, finding IDs and every material fact covered. Source identity or a caller-supplied adequacy label alone cannot skip DELTA mapping. Adoption imports evidence only, not source architecture or mutation authority.
- `FULL` is programme-scope investigation: optional `G_FRAME` -> programme-scope `G0` -> `G1` -> exact Web acceptance. Discovery has no local `G2`, `G3`, or `G4` merely because investigation occurred. G0 remains read-only. An effectful probe requires current X3/Web authority bound to the exact consuming repository, programme, child, baseline revision and operation.

Use the cold [Programme Discovery Baseline](docs/PROGRAMME-DISCOVERY-BASELINE.md) convention for bounded, sanitised observations. It is evidence, not a programme state store, secret store, runtime, or architecture source. `ADOPTED_EQUIVALENT` requires an authoritative current source readback binding exact repository/path/revision and recoverable evidence identity; a digest alone is not a re-verification path. `ACCEPTED` requires a current authoritative G1/Web decision readback binding the exact repository, programme, child, baseline revision, finding IDs, evidence identities, outcome, decision body and body digest; a copied ID or caller-supplied digest is not authority. When a material dependent decision relies on actual workflow behaviour, use a representative real enactment when safe authorised enactment exists; an `OBSERVED` finding requires a current authoritative observation readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and changed facts, plus a safe evidence/reverification reference and current terminal enactment receipt bound to the operation authority. If safe enactment or adequate evidence is unavailable, preserve `UNKNOWN` or `DOCUMENTED_NOT_DEMONSTRATED` with a disposition. `REUSE` requires a current applicability receipt bound to reused findings, checked dependencies and invalidation triggers. `DELTA` requires a complete current dependency/finding readback that maps each changed material fact before local invalidation; missing applicability or mapping is HOLD. Do not present a partial observation as a completed effect. G0 remains read-only; effectful probes require current X3/Web authority. Private material stays in authorised custody and is referenced only through an independently read-back, consumer-resolvable custody receipt. Raw private material is never admitted into a baseline. Cross-repository evidence is sanitised and bound to exact source/revision/evidence identity; it imports no source authority.

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

Before PASS, G2 also acts as the adversarial reviewer of its own proposed contract. It deliberately searches for a materially plausible implementation or interpretation that satisfies the written plan while violating the accepted invariant, plus competing semantic models, equivalent/bypass consumers, replay/reordering/duplication, interruption/recovery, actor/identity substitution and evidence-oracle weaknesses. The contract survives only when challenged assumptions are explicitly bound, the state/protocol/proof model is refined where material, and consequential challenges map to G3 negatives plus positive controls. This is the design/contract analogue of G4 attacking the realised candidate, not a requirement that G2 prove code already works.

G2 terminates as `G2_PASS`, genuine evidence/environment `G2_HOLD`, `G2_REENTRY_REQUIRED` for changed root/trust/Owner/upstream semantics, or `G2_NONCONVERGED`. A `G2_NONCONVERGED` packet names the surviving contradiction, challenged alternatives and smallest missing decision/evidence boundary and returns to Web. Renaming RUN/Lock without materially changed input does not create another admissible G2 episode.

G2 binds:

- acceptance criteria and invariants;
- consequential entry/copy/serialization/consumer boundaries;
- affected consumers;
- permitted and forbidden behaviour;
- exact mutation allowlist;
- positive, negative and adversarial regression oracles;
- causal negative-control requirements that prove the named production actor caused the consequential observation rather than test instrumentation manufacturing it;
- async/liveness and deferred-work accounting requirements when drains/waits/flushes/queues/completion trackers or equivalent boundaries are material;
- for each material stateful/async transition, a named deterministic negative transition regression plus positive control, covering the interruption/replacement/cancellation/late-completion windows that are actually relevant to the state machine;
- for material async/deferred mechanisms, an explicit temporal-semantics model that states whether intermediate work is independently consequential or latest/coalesced only; debounce/coalescing; replacement/supersession/cancellation; retry/idempotency ownership; queue-time versus execution-time/current-state lookup; ordering/duplicates/late completion; and obligation creation/transfer/merge/supersession/cancellation/completion semantics;
- when validation cases share a materially bounded/mutable resource, the resource/equivalence identity, material capacity/window/state semantics, per-case consumption/mutation, later-oracle prerequisite state and one explicit non-interference strategy; prefer faithful isolation, then deterministic reset, then explicit shared-state ordering/ownership, using bounded pacing/window separation only when the real accepted resource is inherently time-windowed and cannot be safely isolated/reset;
- for universal/arbitrary/unknown-behaviour invariants, the concrete enforcement mechanism plus a completeness argument under the actual language/runtime model, including what state/events are observable and which material paths bypass any finite observer;
- for universal/arbitrary/no-bypass/complete-provenance claims, a `MECHANISM_COMPLETENESS_PROOF_MODEL` containing: (a) complete trusted-boundary inventory across executable ingress/egress, exported/callable aliases, receipt producers/consumers, parsers/serializers and binding/admission paths; (b) a material state-machine artefact naming states, transitions, actors/roles, transition authority, duplicate/retry/replacement rules, terminal states and consequential effects; (c) a protocol-schema artefact binding accepted receipt/message/evidence shapes, cardinality, multiplicity, cross-message identities and malformed/unknown-field behaviour; (d) enforcement mapping from every model edge/state/schema obligation to concrete trusted enforcement and production-boundary evidence; and (e) explicit falsifiable runtime/language/provider assumptions. Existing canonical schemas may be referenced rather than duplicated when complete;
- one complete current-requirement coverage manifest: every mandatory acceptance criterion, inherited blocker/defect family and still-required obligation has exactly one disposition (`IMPLEMENT_IN_THIS_CANDIDATE`, `ALREADY_SATISFIED_WITH_EXACT_EVIDENCE`, `UNCHANGED_REQUIRED_CONSUMER`, or `OUT_OF_SCOPE_WITH_EXPLICIT_CONTINUING_OWNER`), and every implemented row maps requirement -> invariant -> consequential boundary -> affected consumers/surfaces -> negative regression -> positive control -> G3 executable proof -> G4 assurance surface;
- for one-screened-boundary/no-bypass claims, a callable-surface inventory covering exported aliases and materially reachable alternate routes, with every public/reachable path bound to the accepted enforcement and internal-only paths explicit;
- for backward/readback/serialization compatibility, immutable predecessor-produced bytes/artifacts from an exact accepted producer revision consumed unchanged by the candidate, rather than candidate-regenerated approximations;
- for semantically equivalent input/state representations, the canonicalisation rule applied before identity/digest/hash/signature and the equivalence regressions that prove identical canonical identity;
- where rejection promises zero user-controlled execution or side effects, the material language/runtime hooks reachable before rejection and the instrumentation proving zero prohibited execution at the real boundary;
- validation and evidence requirements;
- reversal/recovery behaviour;
- correction limits.

For transactional/state-machine work, relevant windows commonly include pre-commit, partial commit, cleanup, and retry after interruption. For async work they commonly include pre-wait, during-wait, replacement/cancellation, late arrival, and completion after a snapshot/decision point. G2 selects the windows that can materially violate the accepted invariant; this is not a mandatory combinatorial matrix.

Validation itself must not manufacture a false candidate failure by perturbing a prerequisite resource used by a later oracle. Examples include rate-limit/quota windows, shared session state, queues, caches, database fixtures/counters, exclusive leases/locks, ports/sockets, provider/API quotas and finite test identities. Isolation/reset must remain faithful to production semantics; do not rotate/spoof identities, disable limits or reset production state in a way that bypasses the invariant. Where the resource is genuinely time-windowed and no faithful isolation/reset exists, use one explicit bounded group/window boundary with attributable evidence rather than scattered sleeps. If the shared interference is itself the behavior under test, declare that intentionally instead of suppressing it. Proven validation self-interference is harness/evidence failure rather than product failure absent separate candidate-defect evidence.

A complete contract is also distinct from a green subset of tests: omission of a still-required criterion/defect family is a contract-coverage failure, even when every implemented row passes. A safe wrapper cannot establish a no-bypass public-boundary claim while another exported/reachable route avoids it. Compatibility is proven with predecessor-produced artifacts, not by regenerating historical-looking bytes with candidate code. Canonical identity is computed only after accepted representation equivalence is normalised. A rejection oracle that requires noninterference observes side effects/hooks before the rejection point; the final error code alone cannot prove zero execution.

Mechanism completeness is distinct from semantic correctness. A finite denylist, observer, hook, lexical brand, parser route, intercepted API or event list cannot implement a universal `any/arbitrary/unknown` invariant unless the runtime model proves that mechanism sees every relevant violating path. If the platform cannot generically introspect the required state after arbitrary/untrusted code has acted, G2 must move enforcement to a complete trusted boundary: invalidate or expire provenance at exposure, copy/normalise into trusted state, re-establish trust after the boundary, or return to G1/Owner when the trust model itself must change. Post-hoc detector coverage is not a substitute for observability the platform does not provide.

For async/deferred work, timer/queue/promise/callback mechanics are evidence about implementation shape, not authority for product semantics. G2 must settle the temporal model from accepted product evidence/Owner authority before G3. Under latest-state debounce/coalescing, replacement may validly supersede an earlier intermediate item because the obligation transfers/merges into the latest consequential state; under each-state-required semantics, replacement/cancellation must preserve or truthfully fail the individual obligation. G3 implements that frozen model and G4 attacks whether the candidate honours it; neither stage may invent a different temporal interpretation from observed mechanics.

A dense finite regression matrix remains necessary falsification/implementation evidence but is not a completeness proof. For an exhaustive claim, the proof model must explain why the trusted boundary is finite and exhaustive and must distinguish materially different execution identities (for example coordinator versus actual executor) when substitution would change the guarantee. State-machine and protocol-schema artefacts may be embedded in an existing canonical contract/IR/schema when that representation is complete; do not manufacture duplicate documentation. G4 directly challenges the proof model by seeking an executable route, multiplicity/replay/reordering, malformed child evidence, identity substitution or state transition absent from the model. A successful such counterexample is `MECHANISM_COMPLETENESS_UNPROVEN` unless it is demonstrably an ordinary implementation defect already inside an accepted complete model.

For material difficult/diagnostic/security/authority-sensitive work, G2 should use a fresh context and ask how an implementation could satisfy the proposed instructions while still violate the accepted invariant.

For expressly simple/low-uncertainty work, one invocation may establish logically separate G1 and G2 decisions when current routing/authority permits it; record the absence of a fresh independent-model challenge.

### G3 — Implementation and validation

G3 implements and validates the complete bounded child candidate within the accepted contract and demonstrates closure at actual consequential/public boundaries, not only helper-level tests.

A repository validator may itself require immutable commit identity or a clean committed working tree. When G2/G3 explicitly binds `COMMIT_REQUIRED_VALIDATION=YES`, run all meaningful checks that do not require commit identity first; after they pass and candidate contents/scope are frozen, create the ordinary immutable local candidate commit under the existing allowance and bind its commit/tree/parent. That candidate identity is byte-stable: do not amend, rebase or reconstruct it. Run the identity/clean-tree-dependent and remaining floor against that exact commit, and publish only after the complete floor passes. The local commit is construction/custody, not a separate G4 lifecycle or publication event. Candidate/product failure returns through normal correction/re-entry; environment/transport/evidence failure preserves the exact commit. If pre-publication identity-bound validation or the required adversarial challenge proves a settled in-contract product RED, ordinary G3 paired convergence permits the next materially distinct correction attempt to produce a new immutable local candidate in the same RUN/Lock and within the existing G3 attempt budget. Preserve the failed candidate as durable evidence; never amend, rebase, reconstruct or overwrite it. Repeat applicable non-commit-dependent checks, freeze corrected contents/scope, and bind each replacement's exact commit/tree/parent before its identity-dependent checks. This pre-publication product correction is distinct from the bounded hosted non-product reclosure rule below and does not authorize publication before one exact candidate completes the full floor.

For stateful/async work, G3 PASS includes an invariant-to-regression map: every material G2 invariant names the executable regression or production-boundary check that proves it, including the relevant transition/interruption case. Aggregate suite-green status cannot substitute for this mapping.

Ordinary implementation choices inside the contract remain G3 work. A discovery that changes the governing invariant, trust boundary or material contract HOLDs for the appropriate re-entry.

Candidate immutability is per exact candidate identity, not a requirement that the entire G3 episode contain only one candidate. After a published/hosted candidate fails required validation, Web may keep the same RUN/Lock/G3 episode and authorise a distinct immutable replacement candidate only after causal ownership is established as HARNESS, TOOLKIT or ENVIRONMENT with `PRODUCT_SEMANTICS_PROVEN_BAD=NO`, while product semantics, root/trust, accepted G2 contract and assurance floor remain unchanged. The correction must be bounded to the exact validation/harness/tooling/environment mechanism. Every failed candidate remains immutable durable evidence; every replacement gets a new commit/tree identity and exact revalidation boundary. This is validation reclosure, not product correction: it consumes no product/G3 correction attempt and resets no budget. Product RED stays in ordinary G3 convergence; contract changes return G2; root/trust changes return G1. Repeating materially equivalent non-product RED without improved causal evidence returns to Web diagnosis rather than candidate churn.

For sufficiently complex/STRICT work involving concurrency, async completion, deferred consequential work, causal negative controls, lifecycle coordination, privilege/context boundaries, identity/resource equivalence or comparable cross-surface implementation risk, G3 uses a paired convergence cycle inside the same G3 episode. One substantive attempt consists of parent implementation/correction, the complete affected integrated validation floor reaching green, then a fresh depth-1 read-only adversarial challenge leaf against those exact current bytes through the selected stack's separately configured G3 adversarial-subagent route. That route is intentionally stronger than the ordinary G3 implementation route. The challenge tries to falsify materially equivalent paths, privilege/context assumptions, lifecycle/recovery, production-boundary reachability, the regression oracle, causal attribution, liveness/progress, outstanding-work accounting, resource-equivalence handling and false-green controls. The leaf never mutates, publishes, grants authority or declares completion. A clean challenge closes that paired attempt successfully for the challenged implementation state and is required before publication/G3 PASS. If it exposes a material settled in-contract implementation defect, the attempt remains unsuccessful; the parent remains sole integrator, begins the next materially distinct correction attempt inside the same RUN/Lock, reruns the affected integrated validation floor to green, then launches a fresh challenge against the updated bytes. The existing G3 convergence envelope applies to these paired attempts as one unit: 3 normal materially distinct attempts and an absolute ceiling of 5 under the narrowed-progress rule. There is no independent reviewer retry budget and no one-leaf-per-G3 ceiling; unchanged-byte rechecks, evidence gathering and typed non-product HOLD recovery do not create substantive attempts. Sequential challenge leaves remain depth-1, with no nested delegation and no new G3 RUN/Lock merely because a prior challenge found an implementation defect. For simple/low-risk G3 this leaf is optional unless the accepted contract/Web requires it. It is not another gate: missing product/compatibility semantics return to G2, and changed root/trust/architecture returns to G1.

The strong G3 challenge leaf returns an implementation-ready diagnostic handoff rather than a bare verdict. Each material finding binds the exact challenged implementation state, causal owner/classification, violated accepted G2 obligation, production/consequential entry, affected paths/symbols/surfaces, deterministic reproducer/evidence, observed versus required outcome/effect, causal explanation, equivalent surfaces checked, smallest suggested in-contract correction direction, negative regression plus same-boundary positive control and effect/zero-effect oracle, scope guard, evidence pointers, and unresolved assumptions. A suggestion does not grant mutation or contract authority; a correction requiring changed semantics/trust/compatibility returns to the responsible G2/G1 boundary. Clean challenge results remain evidentiary: they record the challenged identity, adversarial surfaces/counterexamples attempted, observed production-boundary evidence and materially unexamined areas. This packet is deliberately sufficient for the cheaper G3 parent to consume findings and implement/verify the next in-contract correction without reconstructing the reviewer's root-cause analysis from scratch.

Async validation for a changed drain/wait/flush/join/poll/quiesce/retry/completion boundary includes a waiter-first control where required completion occurs later and depends on event-loop/I/O/timer/callback progress. Required deferred work remains outstanding from scheduling through consequential completion; clearing its scheduling primitive is not completion. Flush semantics either permit the normal dispatch or take ownership of that same work and complete it through the normal consequential path.

Ordinary commits or internal increments do not create separate G4 lifecycles.

Material scope expansion stops the affected work at a safe boundary and returns to Web for amend/split/replan authority.

### Stable-root G3 convergence accounting

Classify each fresh material finding exactly once as `EXISTING_ROOT`, `NEW_ROOT_DISCOVERED`, `CROSS_ROOT_INTERACTION`, `G2_CONTRACT_GAP`, `G1_ROOT_TRUST_CHANGE`, or `NON_PRODUCT_BLOCKER`; an unknown or ambiguous class is a Web HOLD. Attempt admission consumes its finding-bound classification readback for the exact root-ledger revision and complete stable-root set. The current canonical finding-classification readback binds the exact repository, programme, child, RUN/Lock, root-ledger revision, finding ID and complete stable root-family set; missing or contradictory classification and repeated-cross-root-reopening evidence is a Web HOLD. Route `G2_CONTRACT_GAP` to targeted G2 re-entry and `G1_ROOT_TRUST_CHANGE` to G1 reconvergence; `NON_PRODUCT_BLOCKER` stays outside product correction. A product root binds `ROOT_ID`, accepted G2 obligation, causal mechanism/boundary, affected surface, mutation scope, dependencies, unique attempt IDs, consumed attempts and state. Bind the stable causal-family identity and complete current ledger to an authoritative, current root-ledger readback for the exact repository, RUN/Lock and accepted G2 obligation. Caller root names, hashes or booleans cannot establish a new family, separability or prior-attribution audit. A family passes as `EXISTING_ROOT` only when its exact stable key has prior attempt IDs in `priorAttemptAttributionByFamily`; `previouslyAddressedFamilies` membership alone establishes neither prior history nor attempt debt. Without exact prior attempt attribution, it requires a current `NEW_ROOT_DISCOVERED` classification and exact whole-history untouched-attribution audit, or admission holds. Every ordinary episode attempt must be attributed to at least one stable root family in the current records or prior-attribution map, and every root-attributed attempt must be classified ordinary; any mismatch holds before event admission. A new-root prior-attribution audit remains bound after its first attempt is recorded, so moving earlier IDs under a prior family label cannot reset debt.

Count unique substantive attempt IDs from the current authoritative episode ledger and attribute them to the stable causal family, not a finding label. One correction may carry one attempt ID attributed to multiple roots. Equivalent roots merge with the union of unique attempt IDs; never select the minimum count. Renaming, splitting, relabelling a family or changing a caller-supplied key cannot lower debt. A new independent root starts at zero only when the complete current authoritative attribution audit explicitly proves that exact causal family untouched. Keep total historical episode attempts separately from per-root counts and chronology. Attempts 1-3 are normal; attempts 4-5 require independently bound narrowing/progress evidence; attempt 5 is the same-root absolute ceiling, and a sixth ordinary attempt is rejected.

`CROSS_ROOT_INTERACTION` creates no automatic budget. Repeated reopening across roots, root-set growth without closure, ambiguous partition/attribution, unknown classifications, or exhaustion returns to Web. Preserve `WEB_DIRECTED_CONTINUATION` and `RECONVERGED_CORRECTION` histories separately; neither resets the ordinary root budget. A non-product `HOLD` recovery, unchanged-byte reviewer supplementation, or evidence-only recheck is not a product attempt. `WEB_DIRECTED_CONTINUATION` and `RECONVERGED_CORRECTION` each require an exact current authority receipt bound to repository, RUN/Lock, stable root family, attempt identity and scope; caller strings or labels do not establish exceptional authority. Attempt-event observers reject unknown event kinds and enforce the same-root ceiling. Ordinary, WDC, reconverged and episode-history membership comes only from the complete current canonical episode-ledger readback; caller history arrays cannot reset accounting. NON_PRODUCT_HOLD_RECOVERY and UNCHANGED_BYTE_REVIEWER_SUPPLEMENTATION are excluded only when exact current candidate bytes, unchanged-byte comparison and non-product classification readbacks bind the same repository, child, RUN/Lock and root family; otherwise the event is a HOLD or a product attempt.

### Increment 1 ownership fences

| Owner | Boundary |
| --- | --- |
| A1 | Route registration/resolution, including concrete `G0.discovery`. |
| C2 | CURRENT, packets, discovery-basis receipts, durable root ledger, post-child checkpoint runtime. |
| H | Host/browser/computer/native qualification. |
| X1 | Secret References and Private Custody. |
| X2 | Sensitive-File Access Guard. |
| X3 | External Operation Authority and effectful probes. |
| X4 | Privacy-Safe Operational Evidence. |
| W2 | Temporary workspace lifecycle. |
| D1 | Semantics and deterministic policy oracles only. |

The D1 deterministic post-child membership oracle treats an otherwise-applicable required merge check with stale event/trigger/head identity, or a disabled child-required or required-at-merge merge check, as HOLD; event, branch and path non-applicability is evaluated before exact identity matching.

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

## Shipping disposition and current blocker admission

### Machine-readable S1-A policy contract

This Architecture-owned block is the canonical machine-readable semantic contract for the following policy. It is policy-source structure for closed regression interpretation, not a runtime or wire schema and not a C2/D1 implementation. The accompanying prose explains the same rules for humans. A consumer must retain the detailed companion record referenced by every coarse projection.

~~~s1a-policy-contract-v1
{
  "schema": "toolkit.s1a.policy-contract.v1",
  "dispositions": [
    "CURRENT_SHIP_BLOCKER",
    "IMMEDIATE_POST_SHIP",
    "FUTURE_OWNED",
    "OBSERVE",
    "EVIDENCE_ONLY"
  ],
  "lifecycles": [
    "UNRESOLVED",
    "RESOLVED"
  ],
  "evidenceOnly": {
    "effect": "CUSTODY_ONLY",
    "assertsProductDefect": false,
    "authorizesProductCorrection": false,
    "independentEvidenceGatesRemainBinding": true
  },
  "commonRecord": {
    "requiredFields": [
      "FINDING_ID", "REPOSITORY", "PACKET_IDENTITY", "FINDING_REVISION",
      "WEB_ADMITTED_REVISION", "ACCEPTED_DECISION_ID", "ADMITTED_CURRENT_OUTCOME",
      "PROGRAMME_ID", "CHILD_ID", "FRONTIER_ID", "TIMING", "TRIGGER_OR_REASON",
      "CLOSURE_CRITERION", "EXACT_EVIDENCE", "CONTROLLER_ID", "ACCEPTED_CONTRACT_ID",
      "SUBJECT_ID", "CANDIDATE_IDENTITY", "ATTRIBUTION", "PRIMARY_OWNER", "ADJUDICATION",
      "OBSERVED_BEHAVIOR", "REQUIRED_BEHAVIOR", "DISPOSITION", "LIFECYCLE",
      "VERIFIED_OWNER", "OWNER_ROLE", "OWNER_READBACK", "RESOLUTION"
    ],
    "typedFields": {
      "FINDING_ID": "NONEMPTY_STRING",
      "REPOSITORY": "NONEMPTY_STRING",
      "PACKET_IDENTITY": "NONEMPTY_OBJECT",
      "FINDING_REVISION": "NONEMPTY_STRING",
      "WEB_ADMITTED_REVISION": "NONEMPTY_STRING",
      "ACCEPTED_DECISION_ID": "NONEMPTY_STRING",
      "ADMITTED_CURRENT_OUTCOME": "NONEMPTY_OBJECT",
      "PROGRAMME_ID": "NONEMPTY_STRING",
      "CHILD_ID": "NONEMPTY_STRING",
      "FRONTIER_ID": "NONEMPTY_STRING",
      "TIMING": "NONEMPTY_STRING",
      "TRIGGER_OR_REASON": "NONEMPTY_STRING",
      "CLOSURE_CRITERION": "NONEMPTY_STRING",
      "EXACT_EVIDENCE": "NONEMPTY_EVIDENCE_REFERENCES",
      "CONTROLLER_ID": "NONEMPTY_STRING",
      "ACCEPTED_CONTRACT_ID": "NONEMPTY_STRING",
      "SUBJECT_ID": "NONEMPTY_STRING",
      "CANDIDATE_IDENTITY": "NONEMPTY_OBJECT",
      "ATTRIBUTION": "NONEMPTY_STRING",
      "PRIMARY_OWNER": "NONEMPTY_STRING",
      "ADJUDICATION": "NONEMPTY_STRING",
      "OBSERVED_BEHAVIOR": "NONEMPTY_STRING",
      "REQUIRED_BEHAVIOR": "NONEMPTY_STRING",
      "DISPOSITION": "NONEMPTY_STRING",
      "LIFECYCLE": "NONEMPTY_STRING",
      "VERIFIED_OWNER": "NONEMPTY_STRING",
      "OWNER_ROLE": "NONEMPTY_STRING",
      "OWNER_READBACK": "NONEMPTY_OBJECT",
      "RESOLUTION": "NONEMPTY_STRING"
    },
    "nestedRequiredFields": [
      { "record": "PACKET_IDENTITY", "fields": ["repository", "packetId", "packetRevision"] },
      { "record": "CANDIDATE_IDENTITY", "fields": ["commit", "tree"] },
      { "record": "ADMITTED_CURRENT_OUTCOME", "fields": ["id", "milestone", "audience", "environment"] }
    ],
    "nestedBindings": [
      { "left": "PACKET_IDENTITY.repository", "right": "REPOSITORY" }
    ],
    "rejectedRequestState": {
      "ok": false,
      "transition": null,
      "mutationEffects": [],
      "dispositionField": "DISPOSITION",
      "lifecycleField": "LIFECYCLE",
      "requestValuesMaySelectState": false
    },
    "transitionBindings": [
      { "transition": "disposition", "record": "DISPOSITION" },
      { "transition": "sourceLifecycle", "record": "LIFECYCLE" }
    ],
    "canonicalRecordAuthoritative": true,
    "adjudicationMustMatchDisposition": true,
    "resolutionLifecycleBindings": [
      { "lifecycle": "UNRESOLVED", "resolution": "NOT_RESOLVED" },
      { "lifecycle": "RESOLVED", "resolution": "RESOLVED" }
    ],
    "completenessObligation": "F2_COMMON_RECORD_COMPANION_COMPLETENESS",
    "transitionConsistencyObligation": "F1_RECORD_TRANSITION_CONSISTENCY"
  },
  "projectionRows": [
    {
      "disposition": "CURRENT_SHIP_BLOCKER",
      "lifecycle": "UNRESOLVED",
      "twoWay": "SHIP_BLOCKER",
      "v1": "BLOCKING"
    },
    {
      "disposition": "CURRENT_SHIP_BLOCKER",
      "lifecycle": "RESOLVED",
      "twoWay": "SHIP_BLOCKER",
      "v1": "RESOLVED"
    },
    {
      "disposition": "IMMEDIATE_POST_SHIP",
      "lifecycle": "UNRESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "NON_BLOCKING"
    },
    {
      "disposition": "IMMEDIATE_POST_SHIP",
      "lifecycle": "RESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "RESOLVED"
    },
    {
      "disposition": "FUTURE_OWNED",
      "lifecycle": "UNRESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "NON_BLOCKING"
    },
    {
      "disposition": "FUTURE_OWNED",
      "lifecycle": "RESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "RESOLVED"
    },
    {
      "disposition": "OBSERVE",
      "lifecycle": "UNRESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "NON_BLOCKING"
    },
    {
      "disposition": "OBSERVE",
      "lifecycle": "RESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "RESOLVED"
    },
    {
      "disposition": "EVIDENCE_ONLY",
      "lifecycle": "UNRESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "NON_BLOCKING"
    },
    {
      "disposition": "EVIDENCE_ONLY",
      "lifecycle": "RESOLVED",
      "twoWay": "POST_SHIP",
      "v1": "RESOLVED"
    }
  ],
  "blocker": {
    "requiredFields": [
      "WEB_ADMITTED_REVISION",
      "ADMITTED_CURRENT_OUTCOME",
      "LOCKED_CRITERION_OR_FLOOR",
      "SHIP_NOW_CONSEQUENCE",
      "REQUIRED_OUTCOME_EFFECT",
      "SAFE_DEFERRAL_IMPOSSIBLE",
      "SMALLEST_CORRECTION",
      "VERIFIABLE_CLOSURE",
      "EXACT_EVIDENCE",
      "CANDIDATE_IDENTITY",
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_REVISION",
      "ACCEPTED_DECISION_ID",
      "PROGRAMME_ID",
      "CHILD_ID",
      "FRONTIER_ID",
      "CONTROLLER_ID",
      "ACCEPTED_CONTRACT_ID",
      "SUBJECT_ID",
      "OBSERVED_BEHAVIOR",
      "REQUIRED_BEHAVIOR",
      "PRIMARY_OWNER",
      "ATTRIBUTION",
      "ADJUDICATION",
      "OWNER_ROLE",
      "OWNER_READBACK",
      "RESOLUTION"
    ],
    "identityFields": [
      "FINDING_ID",
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_REVISION",
      "WEB_ADMITTED_REVISION",
      "CANDIDATE_IDENTITY",
      "ACCEPTED_DECISION_ID",
      "DISPOSITION",
      "LIFECYCLE",
      "DETAIL_REF"
    ],
    "recordFields": [
      "FINDING_ID",
      "WEB_ADMITTED_REVISION",
      "DISPOSITION",
      "LIFECYCLE",
      "TIMING",
      "VERIFIED_OWNER",
      "TRIGGER_OR_REASON",
      "CLOSURE_CRITERION",
      "EXACT_EVIDENCE",
      "CANDIDATE_IDENTITY",
      "DETAIL_REF",
      "ADMITTED_CURRENT_OUTCOME",
      "LOCKED_CRITERION_OR_FLOOR",
      "SHIP_NOW_CONSEQUENCE",
      "REQUIRED_OUTCOME_EFFECT",
      "SAFE_DEFERRAL_IMPOSSIBLE",
      "SMALLEST_CORRECTION",
      "VERIFIABLE_CLOSURE",
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_REVISION",
      "ACCEPTED_DECISION_ID",
      "PROGRAMME_ID",
      "CHILD_ID",
      "FRONTIER_ID",
      "CONTROLLER_ID",
      "ACCEPTED_CONTRACT_ID",
      "SUBJECT_ID",
      "OBSERVED_BEHAVIOR",
      "REQUIRED_BEHAVIOR",
      "PRIMARY_OWNER",
      "ATTRIBUTION",
      "ADJUDICATION",
      "OWNER_ROLE",
      "OWNER_READBACK",
      "RESOLUTION"
    ],
    "typedPaths": {
      "FINDING_ID": "NONEMPTY_STRING",
      "WEB_ADMITTED_REVISION": "NONEMPTY_STRING",
      "DISPOSITION": "NONEMPTY_STRING",
      "LIFECYCLE": "NONEMPTY_STRING",
      "TIMING": "NONEMPTY_STRING",
      "VERIFIED_OWNER": "NONEMPTY_STRING",
      "TRIGGER_OR_REASON": "NONEMPTY_STRING",
      "CLOSURE_CRITERION": "NONEMPTY_STRING",
      "EXACT_EVIDENCE": "NONEMPTY_EVIDENCE_REFERENCES",
      "CANDIDATE_IDENTITY": "NONEMPTY_OBJECT",
      "DETAIL_REF": "SHA256_REFERENCE",
      "REPOSITORY": "NONEMPTY_STRING",
      "PACKET_IDENTITY": "NONEMPTY_OBJECT",
      "FINDING_REVISION": "NONEMPTY_STRING",
      "ACCEPTED_DECISION_ID": "NONEMPTY_STRING",
      "PROGRAMME_ID": "NONEMPTY_STRING",
      "CHILD_ID": "NONEMPTY_STRING",
      "FRONTIER_ID": "NONEMPTY_STRING",
      "CONTROLLER_ID": "NONEMPTY_STRING",
      "ACCEPTED_CONTRACT_ID": "NONEMPTY_STRING",
      "SUBJECT_ID": "NONEMPTY_STRING",
      "OBSERVED_BEHAVIOR": "NONEMPTY_STRING",
      "REQUIRED_BEHAVIOR": "NONEMPTY_STRING",
      "PRIMARY_OWNER": "NONEMPTY_STRING",
      "ATTRIBUTION": "NONEMPTY_STRING",
      "ADJUDICATION": "NONEMPTY_STRING",
      "OWNER_ROLE": "NONEMPTY_STRING",
      "OWNER_READBACK": "NONEMPTY_OBJECT",
      "RESOLUTION": "NONEMPTY_STRING",
      "ADMITTED_CURRENT_OUTCOME.id": "NONEMPTY_STRING",
      "ADMITTED_CURRENT_OUTCOME.milestone": "NONEMPTY_STRING",
      "ADMITTED_CURRENT_OUTCOME.audience": "NONEMPTY_STRING",
      "ADMITTED_CURRENT_OUTCOME.environment": "NONEMPTY_STRING",
      "LOCKED_CRITERION_OR_FLOOR": "NONEMPTY_STRING",
      "SHIP_NOW_CONSEQUENCE.description": "NONEMPTY_STRING",
      "SHIP_NOW_CONSEQUENCE.effect": "ALLOWED_EFFECT",
      "SHIP_NOW_CONSEQUENCE.evidenceRefs": "NONEMPTY_EVIDENCE_REFERENCES",
      "REQUIRED_OUTCOME_EFFECT": "ALLOWED_EFFECT",
      "SAFE_DEFERRAL_IMPOSSIBLE.satisfied": "EXACT_TRUE",
      "SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs": "NONEMPTY_EVIDENCE_REFERENCES",
      "SMALLEST_CORRECTION": "NONEMPTY_STRING",
      "VERIFIABLE_CLOSURE.oracleId": "NONEMPTY_STRING",
      "VERIFIABLE_CLOSURE.positiveControlId": "NONEMPTY_STRING",
      "VERIFIABLE_CLOSURE.evidenceRefs": "NONEMPTY_EVIDENCE_REFERENCES"
    },
    "nestedShapeMode": "EXACT_DECLARED_FIELDS",
    "admissionReadback": {
      "mode": "CURRENT_AUTHORITATIVE_READBACK",
      "field": "admissionReadback",
      "source": "CANONICAL_WEB_ADMISSION",
      "requiredFields": [
        "source", "authoritative", "current", "readBack",
        "repository", "revision", "body", "bodyDigest"
      ],
      "bodySchema": "toolkit.s1a.web-admission.v1",
      "bodyDigestMode": "SHA256_EXACT_READBACK_BODY"
    },
    "admittedDisposition": "CURRENT_SHIP_BLOCKER",
    "admittedLifecycle": "UNRESOLVED",
    "allowedEffects": [
      "FALSE",
      "MATERIALLY_UNSAFE",
      "UNASSURABLE"
    ],
    "bindings": [
      {
        "record": "FINDING_ID",
        "decision": "findingId"
      },
      {
        "record": "REPOSITORY",
        "decision": "repository"
      },
      {
        "record": "PACKET_IDENTITY",
        "decision": "packetIdentity"
      },
      {
        "record": "FINDING_REVISION",
        "decision": "findingRevision"
      },
      {
        "record": "ACCEPTED_DECISION_ID",
        "decision": "acceptedDecisionId"
      },
      {
        "record": "ADJUDICATION",
        "decision": "adjudication"
      },
      {
        "record": "WEB_ADMITTED_REVISION",
        "decision": "webRevision"
      },
      {
        "record": "ADMITTED_CURRENT_OUTCOME",
        "decision": "currentOutcome"
      },
      {
        "record": "REQUIRED_OUTCOME_EFFECT",
        "decision": "requiredOutcomeEffect"
      },
      {
        "record": "VERIFIABLE_CLOSURE.oracleId",
        "decision": "closureCriterion"
      },
      {
        "record": "CANDIDATE_IDENTITY",
        "decision": "candidateIdentity"
      },
      {
        "record": "DETAIL_REF",
        "decision": "detailRef"
      }
    ],
    "membershipBindings": [
      {
        "record": "LOCKED_CRITERION_OR_FLOOR",
        "decision": "acceptedCriteria"
      },
      {
        "record": "EXACT_EVIDENCE",
        "decision": "evidenceRefs"
      }
    ],
    "truthChecks": [
      {
        "record": "SAFE_DEFERRAL_IMPOSSIBLE",
        "path": "satisfied",
        "value": true
      }
    ],
    "nestedRequiredFields": [
      {
        "record": "ADMITTED_CURRENT_OUTCOME",
        "fields": [
          "id",
          "milestone",
          "audience",
          "environment"
        ]
      },
      {
        "record": "SHIP_NOW_CONSEQUENCE",
        "fields": [
          "description",
          "effect",
          "evidenceRefs"
        ]
      },
      {
        "record": "SAFE_DEFERRAL_IMPOSSIBLE",
        "fields": [
          "satisfied",
          "evidenceRefs"
        ]
      },
      {
        "record": "VERIFIABLE_CLOSURE",
        "fields": [
          "oracleId",
          "positiveControlId",
          "evidenceRefs"
        ]
      }
    ],
    "evidenceReferencePaths": [
      "EXACT_EVIDENCE",
      "SHIP_NOW_CONSEQUENCE.evidenceRefs",
      "SAFE_DEFERRAL_IMPOSSIBLE.evidenceRefs",
      "VERIFIABLE_CLOSURE.evidenceRefs"
    ],
    "effectBinding": {
      "record": "REQUIRED_OUTCOME_EFFECT",
      "consequence": "SHIP_NOW_CONSEQUENCE.effect"
    },
    "proofBinding": {
      "mode": "SAME_CONTENT_ADDRESSED_COMPANION_RECORD",
      "fields": [
        "FINDING_ID",
        "WEB_ADMITTED_REVISION",
        "DISPOSITION",
        "LIFECYCLE",
        "TIMING",
        "VERIFIED_OWNER",
        "TRIGGER_OR_REASON",
        "CLOSURE_CRITERION",
        "EXACT_EVIDENCE",
        "CANDIDATE_IDENTITY",
        "ADMITTED_CURRENT_OUTCOME",
        "LOCKED_CRITERION_OR_FLOOR",
        "SHIP_NOW_CONSEQUENCE",
        "REQUIRED_OUTCOME_EFFECT",
        "SAFE_DEFERRAL_IMPOSSIBLE",
        "SMALLEST_CORRECTION",
        "VERIFIABLE_CLOSURE",
        "REPOSITORY",
        "PACKET_IDENTITY",
        "FINDING_REVISION",
        "ACCEPTED_DECISION_ID",
        "PROGRAMME_ID",
        "CHILD_ID",
        "FRONTIER_ID",
        "CONTROLLER_ID",
        "ACCEPTED_CONTRACT_ID",
        "SUBJECT_ID",
        "OBSERVED_BEHAVIOR",
        "REQUIRED_BEHAVIOR",
        "PRIMARY_OWNER",
        "ATTRIBUTION",
        "ADJUDICATION",
        "OWNER_ROLE",
        "OWNER_READBACK",
        "RESOLUTION"
      ]
    }
  },
  "companion": {
    "requiredFields": [
      "FINDING_ID",
      "WEB_ADMITTED_REVISION",
      "DISPOSITION",
      "LIFECYCLE",
      "TIMING",
      "VERIFIED_OWNER",
      "TRIGGER_OR_REASON",
      "CLOSURE_CRITERION",
      "EXACT_EVIDENCE",
      "CANDIDATE_IDENTITY",
      "ADMITTED_CURRENT_OUTCOME",
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_REVISION",
      "ACCEPTED_DECISION_ID",
      "PROGRAMME_ID",
      "CHILD_ID",
      "FRONTIER_ID",
      "CONTROLLER_ID",
      "ACCEPTED_CONTRACT_ID",
      "SUBJECT_ID",
      "OBSERVED_BEHAVIOR",
      "REQUIRED_BEHAVIOR",
      "PRIMARY_OWNER",
      "ATTRIBUTION",
      "ADJUDICATION",
      "OWNER_ROLE",
      "OWNER_READBACK",
      "RESOLUTION"
    ],
    "projectionBindingFields": [
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_ID",
      "FINDING_REVISION",
      "WEB_ADMITTED_REVISION",
      "DISPOSITION",
      "LIFECYCLE",
      "CANDIDATE_IDENTITY",
      "ACCEPTED_DECISION_ID",
      "ADMITTED_CURRENT_OUTCOME",
      "ATTRIBUTION"
    ],
    "legacyProjectionFields": [
      "TWO_WAY",
      "V1"
    ],
    "referenceField": "DETAIL_REF",
    "recordReferenceField": "ref",
    "referenceMode": "CANONICAL_RECORD_SHA256",
    "currentUniquenessFields": [
      "REPOSITORY",
      "PACKET_IDENTITY",
      "FINDING_ID",
      "WEB_ADMITTED_REVISION",
      "CANDIDATE_IDENTITY"
    ],
    "typedFields": {
      "FINDING_ID": "NONEMPTY_STRING",
      "WEB_ADMITTED_REVISION": "NONEMPTY_STRING",
      "DISPOSITION": "NONEMPTY_STRING",
      "LIFECYCLE": "NONEMPTY_STRING",
      "TIMING": "NONEMPTY_STRING",
      "VERIFIED_OWNER": "NONEMPTY_STRING",
      "TRIGGER_OR_REASON": "NONEMPTY_STRING",
      "CLOSURE_CRITERION": "NONEMPTY_STRING",
      "EXACT_EVIDENCE": "NONEMPTY_EVIDENCE_REFERENCES",
      "CANDIDATE_IDENTITY": "NONEMPTY_OBJECT",
      "ADMITTED_CURRENT_OUTCOME": "NONEMPTY_OBJECT",
      "REPOSITORY": "NONEMPTY_STRING",
      "PACKET_IDENTITY": "NONEMPTY_OBJECT",
      "FINDING_REVISION": "NONEMPTY_STRING",
      "ACCEPTED_DECISION_ID": "NONEMPTY_STRING",
      "PROGRAMME_ID": "NONEMPTY_STRING",
      "CHILD_ID": "NONEMPTY_STRING",
      "FRONTIER_ID": "NONEMPTY_STRING",
      "CONTROLLER_ID": "NONEMPTY_STRING",
      "ACCEPTED_CONTRACT_ID": "NONEMPTY_STRING",
      "SUBJECT_ID": "NONEMPTY_STRING",
      "OBSERVED_BEHAVIOR": "NONEMPTY_STRING",
      "REQUIRED_BEHAVIOR": "NONEMPTY_STRING",
      "PRIMARY_OWNER": "NONEMPTY_STRING",
      "ATTRIBUTION": "NONEMPTY_STRING",
      "ADJUDICATION": "NONEMPTY_STRING",
      "OWNER_ROLE": "NONEMPTY_STRING",
      "OWNER_READBACK": "NONEMPTY_OBJECT",
      "RESOLUTION": "NONEMPTY_STRING"
    },
    "currentInventory": {
      "mode": "CURRENT_AUTHORITATIVE_COMPLETE_READBACK",
      "source": "CURRENT_WEB_ADMISSION_COMPANION_INVENTORY",
      "readbackFields": [
        "source",
        "authoritative",
        "current",
        "complete",
        "readBack",
        "repository",
        "packetIdentity",
        "acceptedDecisionIds",
        "candidateIdentities",
        "revision",
        "records",
        "digest"
      ],
      "recordFields": ["ref", "record"],
      "digestMode": "CANONICAL_COMPLETE_RECORD_INVENTORY_SHA256",
      "recordsField": "records"
    },
    "historicalEvidenceMode": "APPEND_ONLY_CONTENT_ADDRESSED",
    "historySource": "CANONICAL_IMMUTABLE_COMPANION_LEDGER",
    "historyAnchor": {
      "source": "CURRENT_CANONICAL_PARENT_CONTRACT",
      "field": "companionHistoryDigest",
      "digestMode": "CANONICAL_LEDGER_SHA256",
      "ledgerDigestBinds": "COMPLETE_APPEND_ONLY_RECORDS",
      "readBackRequired": true,
      "parentReadbackFields": ["source", "authoritative", "current", "readBack", "repository", "revision", "body", "bodyDigest"],
      "parentBodyBindsLedgerDigest": true
    }
  },
  "lifecycleTransitions": [
    {
      "event": "DEFER",
      "from": "UNRESOLVED",
      "to": "UNRESOLVED",
      "requires": [
        "VERIFIED_OWNER",
        "TIMING",
        "TRIGGER_OR_REASON"
      ],
      "requiredValueTypes": {
        "VERIFIED_OWNER": "NONEMPTY_STRING",
        "TIMING": "NONEMPTY_STRING",
        "TRIGGER_OR_REASON": "NONEMPTY_STRING"
      }
    },
    {
      "event": "TRANSFER",
      "from": "UNRESOLVED",
      "to": "UNRESOLVED",
      "requires": [
        "VERIFIED_OWNER",
        "OWNER_READBACK"
      ],
      "requiredValueTypes": {
        "VERIFIED_OWNER": "NONEMPTY_STRING",
        "OWNER_READBACK": "NONEMPTY_OBJECT"
      },
      "ownerReadback": {
        "source": "CURRENT_AUTHORITATIVE_OWNERSHIP_READBACK",
        "trustedContextField": "currentOwnershipReadback",
        "mustBeSuppliedIndependently": true,
        "mustNotAliasRequestedRecord": true,
        "mustMatchRecordReadbackExactly": true,
        "mustMatchIndependentAuthoritySnapshot": true,
        "requiredFields": ["source", "authoritative", "current", "readBack", "repository", "packetIdentity", "findingId", "webAdmittedRevision", "findingRevision", "candidateIdentity", "acceptedDecisionId", "admittedCurrentOutcome", "programmeId", "childId", "frontierId", "timing", "triggerOrReason", "closureCriterion", "exactEvidence", "controllerId", "acceptedContractId", "subjectId", "attribution", "observedBehavior", "requiredBehavior", "primaryOwner", "adjudication", "disposition", "lifecycle", "ownerRole", "owner", "resolution", "revision", "digest"],
        "recordBindings": [
          { "readback": "repository", "record": "REPOSITORY" },
          { "readback": "packetIdentity", "record": "PACKET_IDENTITY" },
          { "readback": "findingId", "record": "FINDING_ID" },
          { "readback": "webAdmittedRevision", "record": "WEB_ADMITTED_REVISION" },
          { "readback": "findingRevision", "record": "FINDING_REVISION" },
          { "readback": "candidateIdentity", "record": "CANDIDATE_IDENTITY" },
          { "readback": "acceptedDecisionId", "record": "ACCEPTED_DECISION_ID" },
          { "readback": "admittedCurrentOutcome", "record": "ADMITTED_CURRENT_OUTCOME" },
          { "readback": "programmeId", "record": "PROGRAMME_ID" },
          { "readback": "childId", "record": "CHILD_ID" },
          { "readback": "frontierId", "record": "FRONTIER_ID" },
          { "readback": "timing", "record": "TIMING" },
          { "readback": "triggerOrReason", "record": "TRIGGER_OR_REASON" },
          { "readback": "closureCriterion", "record": "CLOSURE_CRITERION" },
          { "readback": "exactEvidence", "record": "EXACT_EVIDENCE" },
          { "readback": "controllerId", "record": "CONTROLLER_ID" },
          { "readback": "acceptedContractId", "record": "ACCEPTED_CONTRACT_ID" },
          { "readback": "subjectId", "record": "SUBJECT_ID" },
          { "readback": "attribution", "record": "ATTRIBUTION" },
          { "readback": "observedBehavior", "record": "OBSERVED_BEHAVIOR" },
          { "readback": "requiredBehavior", "record": "REQUIRED_BEHAVIOR" },
          { "readback": "primaryOwner", "record": "PRIMARY_OWNER" },
          { "readback": "adjudication", "record": "ADJUDICATION" },
          { "readback": "disposition", "record": "DISPOSITION" },
          { "readback": "lifecycle", "record": "LIFECYCLE" },
          { "readback": "ownerRole", "record": "OWNER_ROLE" },
          { "readback": "owner", "record": "VERIFIED_OWNER" },
          { "readback": "resolution", "record": "RESOLUTION" }
        ],
        "digestMode": "CANONICAL_READBACK_CORE_SHA256",
        "resolutionMustRemain": "NOT_RESOLVED"
      }
    },
    {
      "event": "EVIDENCE_ACQUIRED",
      "from": "UNRESOLVED",
      "to": "UNRESOLVED",
      "requires": [
        "EXACT_EVIDENCE"
      ],
      "requiredValueTypes": {
        "EXACT_EVIDENCE": "NONEMPTY_EVIDENCE_REFERENCES"
      }
    },
    {
      "event": "VERIFIED_CLOSURE",
      "from": "UNRESOLVED",
      "to": "RESOLVED",
      "requires": [
        "CLOSURE_CRITERION",
        "EXACT_EVIDENCE"
      ],
      "requiredValueTypes": {
        "CLOSURE_CRITERION": "NONEMPTY_STRING",
        "EXACT_EVIDENCE": "NONEMPTY_EVIDENCE_REFERENCES"
      }
    }
  ],
  "closureVerification": {
    "mode": "CURRENT_AUTHORITATIVE_WEB_CLOSURE_READBACK",
    "source": "CURRENT_WEB_CLOSURE_ADMISSION",
    "commonRecordField": "commonRecord",
    "commonRecordMode": "EXACT_CANONICAL_TRANSITION_SOURCE_RECORD",
    "commonRecordFieldsFrom": "commonRecord.requiredFields",
    "requiredFields": [
      "source", "authoritative", "current", "readBack", "repository", "revision",
      "findingId", "webAdmittedRevision", "disposition", "fromLifecycle", "toLifecycle",
      "closureCriterion", "exactEvidence", "candidateIdentity", "commonRecord", "body", "bodyDigest"
    ],
    "bodyFields": [
      "repository", "findingId", "webAdmittedRevision", "disposition",
      "fromLifecycle", "toLifecycle", "closureCriterion", "exactEvidence", "candidateIdentity", "commonRecord"
    ],
    "digestMode": "SHA256_EXACT_READBACK_BODY",
    "resolvesOnlyAfterVerifiedReadback": true,
    "retainsAdmittedDisposition": true
  },
  "postChildReview": {
    "trigger": "FINAL_DELIVERY_CHILD_MERGE",
    "scope": "WHOLE_PROGRAMME",
    "readOnly": true,
    "assuranceModes": ["RECONCILE_ONLY", "DUAL_MAX"],
    "forbiddenModes": ["SINGLE_MAX"],
    "sharedPrerequisites": [
      "EXACT_INTEGRATED_IDENTITY",
      "CURRENT_PARENT_STATE",
      "CURRENT_CHILD_STATE",
      "RECEIPT_MEMBERSHIP",
      "CHECK_MEMBERSHIP",
      "FINALITY_AND_DEPENDENCY_STATE"
    ],
    "modeSelection": {
      "selectionRequiresSharedPrerequisites": true,
      "treeEqualityIsSufficientByItself": false,
      "controllerOrArchitectureTouchAloneTriggersDual": false,
      "reconcileOnlyRequiredPredicates": [
        "MERGE_TREE_EQUALS_ASSURED_CHILD_TREE",
        "NO_UNASSURED_CONCURRENT_OR_MULTI_CHILD_COMPOSITION",
        "NO_CONFLICT_RESOLUTION_SEMANTIC_DELTA",
        "CHILD_TERMINAL_FINALITY_COHERENT",
        "PARENT_CURRENT_FRONTIER_DEPENDENCIES_COHERENT",
        "NO_UNRESOLVED_MATERIAL_DEPENDENT_FINDING",
        "COMPLETE_APPLICABLE_MERGE_CHECK_MEMBERSHIP",
        "ALL_APPLICABLE_MERGE_CHECKS_TERMINAL_GREEN",
        "NO_EXPLICIT_DUAL_REQUIREMENT",
        "NOT_FINAL_DELIVERY_CHILD"
      ],
      "dualMaxTriggers": [
        "INTEGRATION_TREE_DELTA",
        "CONCURRENT_OR_MULTI_CHILD_COMPOSITION",
        "MATERIAL_ROOT_TRUST_AUTHORITY_INTEGRATION_OUTSIDE_ASSURED_TREE",
        "UNRESOLVED_INTEGRATION_UNCERTAINTY",
        "EXPLICIT_OWNER_WEB_G4_REQUIREMENT",
        "FINAL_DELIVERY_CHILD"
      ]
    },
    "checkMembership": {
      "deriveBeforeResults": true,
      "includeAllApplicableFirstPartyChecks": true,
      "binds": [
        "AUTHORITATIVE_CHECK_CONFIGURATION",
        "EVENT_BRANCH_PATH_CONDITIONS",
        "CHILD_REQUIRED_CHECKS",
        "ALL_APPLICABLE_FIRST_PARTY_MERGE_TRIGGERED_CHECKS",
        "EXPECTED_MERGE_CHECK_MEMBERSHIP",
        "MEMBERSHIP_FREEZE_POINT",
        "TERMINAL_READBACK_RULE",
        "PREMERGE_ONLY_VS_MERGE_TRIGGERED_RULE",
        "MISSING_EXPECTED_CHECK_RULE",
        "NOT_APPLICABLE_RULE"
      ],
      "authorityReadbacks": {
        "configuration": "CURRENT_CANONICAL_CHECK_CONFIGURATION_READBACK",
        "terminalRuns": "CURRENT_CANONICAL_LATEST_RUN_READBACK",
        "allIdentityFieldsRequired": true,
        "bindExpectedMembershipTo": ["EVENT_TRIGGER_HEAD", "CANONICAL_CHILD_INVENTORY", "TERMINAL_RESULT_INVENTORY", "REVIEW_SNAPSHOT"],
        "emptyMembershipRequiresCompleteAuthoritativeReadback": true
      },
      "membershipIdentityFields": ["producerId", "workflowId", "workflowRevision", "checkId", "matrixLeg", "eventIdentity", "triggerId", "headSha"],
      "terminalReadbackFields": ["producerId", "workflowId", "workflowRevision", "runId", "checkId", "matrixLeg", "eventIdentity", "triggerId", "headSha", "terminalReadback", "terminal", "conclusion"],
      "emptyMembershipValidWhenProven": true,
      "falseGreenRejections": [
        "GREENS_ONLY_MEMBERSHIP",
        "CO_OMITTED_EXPECTED_CHECK",
        "WRONG_PRODUCER_SAME_DISPLAY_NAME",
        "SKIPPED_CANCELLED_FAILED_DEPENDENCY_AS_NOT_APPLICABLE",
        "AMBIGUOUS_DYNAMIC_MATRIX_EXPANSION",
        "STALE_SUCCESSFUL_RERUN_OR_PREDECESSOR",
        "NEW_APPLICABLE_CONFIGURATION_AFTER_FREEZE"
      ]
    },
    "dualMaxReview": {
      "bothSlotsRequired": true,
      "readOnly": true,
      "sameImmutableSnapshot": true,
      "mutuallyBlindUntil": "BOTH_REPORTS_TERMINAL",
      "unavailableReviewerOutcome": "HOLD",
      "singleReviewFallback": false,
      "finalDeliveryChildRequiresDual": true
    },
    "parentContractMode": "CURRENT_CANONICAL_AUTHORITATIVE",
    "parentContractBodyField": "body",
    "parentContractDigestField": "bodyDigest",
    "parentContractDigestMode": "SHA256_EXACT_READBACK_BODY",
    "parentContractReadbackFields": [
      "source", "authoritative", "current", "readBack", "repository", "revision", "body", "bodyDigest"
    ],
    "integratedIdentityField": "integratedIdentityReadback",
    "integratedIdentityMode": "CANONICAL_MERGED_DELIVERY_CHILD_READBACK",
    "integratedIdentityReadbackFields": [
      "source", "authoritative", "current", "readBack", "repository", "deliveryChildId",
      "commit", "tree", "mergeReceiptId", "digest"
    ],
    "deliveryChildStateIdentityField": "childId",
    "childStateCurrentField": "current",
    "childStateMustBeCurrent": true,
    "childStateReadbackMode": "CURRENT_AUTHORITATIVE_CANONICAL_READBACK",
    "receiptInventoryField": "terminalReceiptIds",
    "checkInventoryField": "applicableIntegratedCheckIds",
    "acceptedChildStates": [
      "CURRENT",
      "COMPLETED"
    ],
    "reviewSlots": [
      {
        "slot": "A",
        "scope": "WHOLE_PROGRAMME",
        "readOnly": true,
        "routeSlot": "A"
      },
      {
        "slot": "B",
        "scope": "WHOLE_PROGRAMME",
        "readOnly": true,
        "routeSlot": "B"
      }
    ],
    "reviewRouteAuthorityMode": "CURRENT_OWNER_WEB_AUTHORITY_READBACK",
    "reviewRouteAuthorityField": "reviewRouteAuthority",
    "reviewRouteAuthorityFields": [
      "source", "authoritative", "current", "readBack", "authorityReference", "revision", "routes", "digest"
    ],
    "reviewRouteFields": ["provider", "model", "reasoning"],
    "reviewerIdentityFields": ["reviewerId", "contextId"],
    "sameSnapshotFields": [
      "repository",
      "deliveryChildId",
      "commit",
      "tree",
      "reviewRouteAuthorityRevision",
      "reviewRouteAuthorityDigest",
      "parentContractRevision",
      "parentContractDigest",
      "childStateRevision",
      "childStateDigest",
      "terminalReceiptIds",
      "applicableIntegratedCheckIds"
    ],
    "blindUntil": "BOTH_REPORTS_TERMINAL",
    "trace": {
      "requiredEvents": [
        "FINAL_DELIVERY_CHILD_MERGED",
        "INTEGRATED_IDENTITY_READ_BACK",
        "CURRENT_PARENT_CONTRACT_READ_BACK",
        "CURRENT_CHILD_STATE_READ_BACK",
        "REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK",
        "APPLICABLE_CHECK_MEMBERSHIP_READ_BACK",
        "MERGE_TRIGGERED_CI_STARTED",
        "REVIEW_A_STARTED",
        "REVIEW_B_STARTED",
        "REPORT_A_TERMINAL",
        "REPORT_B_TERMINAL",
        "TERMINAL_RECEIPTS_READ_BACK",
        "TERMINAL_RECEIPTS_TERMINAL",
        "APPLICABLE_CHECKS_READ_BACK",
        "APPLICABLE_CHECKS_TERMINAL",
        "WEB_ADJUDICATION"
      ],
      "reviewStartsAfter": [
        "FINAL_DELIVERY_CHILD_MERGED",
        "INTEGRATED_IDENTITY_READ_BACK",
        "CURRENT_PARENT_CONTRACT_READ_BACK",
        "CURRENT_CHILD_STATE_READ_BACK",
        "REQUIRED_RECEIPT_MEMBERSHIP_READ_BACK",
        "APPLICABLE_CHECK_MEMBERSHIP_READ_BACK"
      ],
      "peerVisibilityEvents": [
        "REPORT_A_VISIBLE_TO_B",
        "REPORT_B_VISIBLE_TO_A"
      ],
      "bothReviewsStartBeforeAnyReport": true,
      "adjudicationAfter": [
        "REPORT_A_TERMINAL",
        "REPORT_B_TERMINAL",
        "TERMINAL_RECEIPTS_READ_BACK",
        "TERMINAL_RECEIPTS_TERMINAL",
        "APPLICABLE_CHECKS_READ_BACK",
        "APPLICABLE_CHECKS_TERMINAL"
      ],
      "terminalReadbackPrecedes": [
        ["TERMINAL_RECEIPTS_READ_BACK", "TERMINAL_RECEIPTS_TERMINAL"],
        ["APPLICABLE_CHECKS_READ_BACK", "APPLICABLE_CHECKS_TERMINAL"]
      ]
    },
    "frontierEffect": "DEPENDENT_NEXT_CHILD",
    "receiptInventoryMode": "CANONICAL_AUTHORITATIVE_COMPLETE_TERMINAL_READBACK",
    "checkInventoryMode": "CANONICAL_AUTHORITATIVE_COMPLETE_TERMINAL_READBACK",
    "childStateDigestMode": "CANONICAL_STATE_SHA256",
    "inventorySources": {
      "receipts": "CANONICAL_TERMINAL_OBJECT_RECEIPT_READBACK",
      "checks": "CANONICAL_APPLICABLE_INTEGRATED_CHECK_READBACK"
    }
  },
  "faithfulCarrier": {
    "inventory": {
      "mode": "CURRENT_AUTHORITATIVE_COMPLETE_READBACK",
      "inputField": "authoritativeInventory",
      "source": "CURRENT_OWNER_WEB_CARRIER_INVENTORY",
      "requiredFields": ["source", "authoritative", "current", "complete", "readBack", "repository", "revision", "criterion", "candidateIdentity", "records", "digest"],
      "recordFields": ["carrierId", "identity", "executionSubstrate", "available", "authorized", "ownerProvisioned", "faithful", "actualPath", "acceptedExecutionPath", "enforcementBoundary", "reconciliation", "provisioning"],
      "reconciliationFields": ["source", "authoritative", "current", "complete", "readBack", "inventoryRevision", "carrierId", "identity", "actualPath", "suitability", "necessity", "digest"],
      "localFirstWhenFaithful": true,
      "reconcileExistingBeforeProvisioning": true,
      "provisionOnlyAfterNecessityProven": true,
      "requestCannotChangeInventory": true
    },
    "selectionOrder": [
      "LOCAL_DEV",
      "AUTHORIZED_EXISTING_OWNER",
      "NEW_OWNER_PROVISIONED"
    ],
    "defaultExposure": "PRIVATE_NONPUBLIC",
    "acceptedBoundaryId": "ACCEPTED_PRODUCTION_BOUNDARY",
    "faithfulnessRule": "EXERCISED_ACCEPTED_BOUNDARY",
    "boundaryExercise": {
      "mode": "INDEPENDENTLY_BOUND_TERMINAL_EXECUTION_EVIDENCE",
      "evidenceInputField": "acceptedBoundaryEvidence",
      "carrierIdentityField": "identity",
      "acceptedCarrierIds": ["LOCAL_DEV", "AUTHORIZED_EXISTING_OWNER", "NEW_OWNER_PROVISIONED"],
      "readbackFields": [
        "source", "authoritative", "current", "complete", "readBack", "repository",
        "acceptedCriterion", "carrierId", "carrierIdentity", "actualPath", "candidateIdentity",
        "enforcementBoundary", "run", "receipt", "digest"
      ],
      "requiredFields": [
        "receiptId",
        "acceptedCriterion",
        "carrierId",
        "carrierIdentity",
        "candidateIdentity",
        "boundaryId",
        "enforcementBoundary",
        "actualPath",
        "executionPath",
        "outcome",
        "terminal",
        "evidenceRef",
        "runId",
        "runEvents",
        "executionEvidenceDigest",
        "receiptDigest"
      ],
      "acceptedExecutionPath": "ACCEPTED_PRODUCTION_PATH",
      "acceptedOutcome": "BOUNDARY_EXERCISED",
      "requiredRunEvents": [
        "CANDIDATE_BOUND",
        "ACCEPTED_BOUNDARY_INVOKED",
        "BOUNDARY_OUTCOME_OBSERVED",
        "RUN_TERMINAL"
      ]
    },
    "publicExposureRequires": [
      "ACCEPTED_CRITERION",
      "EXPLICIT_EXPOSURE_AUTHORITY",
      "CONSUMER",
      "PROTOCOL",
      "PATH",
      "HOSTNAME",
      "NECESSITY",
      "AUDIENCE",
      "BOUNDARY",
      "LIFETIME",
      "CLEANUP"
    ],
    "publicExposureAuthority": {
      "mode": "CURRENT_OWNER_WEB_AUTHORITY_READBACK",
      "inputField": "exposureAuthority",
      "requestField": "publicExposureRequest",
      "requestMatchFields": ["consumer", "protocol", "path", "hostnameRequired", "hostname", "lifetime", "cleanup", "necessity"],
      "source": "CURRENT_OWNER_WEB_AUTHORITY",
      "requiredFields": [
        "source", "authoritative", "current", "readBack", "authorityReference",
        "criterion", "exposure", "consumer", "protocol", "path", "hostnameRequired", "hostname",
        "audience", "boundary", "lifetime", "cleanup", "necessity", "requiredOperations", "digest"
      ],
      "digestMode": "SHA256_CANONICAL_AUTHORITY_READBACK",
      "exposureValue": "PUBLIC"
    },
    "domainDnsAuthority": {
      "requiredOperationsField": "requiredOperations",
    "domainInputField": "domainAuthority",
      "dnsInputField": "dnsAuthority",
      "requiredFields": [
        "source", "authoritative", "current", "readBack", "authorityReference",
        "exposureReference", "operation", "target", "digest"
      ],
      "domainOperation": "DOMAIN_REGISTRATION",
      "dnsOperation": "DNS_CONFIGURATION",
      "referencesMustDiffer": true,
      "eachReferenceMustDifferFromExposure": true
    },
    "domainDnsRequiresSeparateAuthority": true,
    "persistenceImpliesExposure": false
  },
  "boundedContinuation": {
    "eligiblePrimaryOwners": ["HARNESS", "TOOLKIT", "ENVIRONMENT", "VALIDATION_CARRIER", "TRANSPORT"],
    "excludedAutonomousOwners": ["PRODUCT", "UNKNOWN"],
    "productSemanticsRequired": "NO",
    "episodeAuthority": {
      "mode": "CURRENT_EXPLICIT_WEB_BOUNDED_EPISODE",
      "requiredFields": ["repository", "webAuthorityIdentity", "webAuthorityRevision", "webAuthorityContent", "episodeId", "episodeKind", "runId", "lockId", "authorityReference", "primaryOwner", "source", "authoritative", "current", "readBack", "explicitWebBound", "digest", "rootFamilyId", "acceptedContractId", "trustModelId", "scopeId", "assuranceFloorId", "evidenceBoundaryId"],
      "kindBinding": "EXACT_CURRENT_INDEPENDENT_WEB_READBACK",
      "anyExplicitWebBoundKindAllowedWhenIndependentlyAccepted": true
    },
    "acceptedAuthorityBinding": {
      "source": "CURRENT_ACCEPTED_G2_EPISODE_AUTHORITY_READBACK",
      "stateField": "acceptedEpisodeAuthority",
      "requiredFields": ["repository", "webAuthorityIdentity", "webAuthorityRevision", "webAuthorityContent", "episodeId", "episodeKind", "runId", "lockId", "authorityReference", "primaryOwner", "rootFamilyId", "acceptedContractId", "trustModelId", "scopeId", "assuranceFloorId", "evidenceBoundaryId"],
      "mustMatchIndependentAcceptedReadback": true
    },
    "acceptedBoundaryBinding": {
      "inputField": "acceptedBoundary",
      "source": "CURRENT_ACCEPTED_G2_BOUNDARY_READBACK",
      "requiredFields": ["source", "authoritative", "current", "readBack", "repository", "webAuthorityIdentity", "webAuthorityRevision", "webAuthorityContent", "episodeId", "episodeKind", "runId", "lockId", "authorityReference", "rootFamilyId", "acceptedContractId", "trustModelId", "scopeId", "assuranceFloorId", "evidenceBoundaryId", "digest"],
      "episodeFields": ["repository", "webAuthorityIdentity", "webAuthorityRevision", "webAuthorityContent", "episodeId", "episodeKind", "runId", "lockId", "authorityReference", "rootFamilyId", "acceptedContractId", "trustModelId", "scopeId", "assuranceFloorId", "evidenceBoundaryId"],
      "mustRemainExact": true
    },
    "currentStateReadback": {
      "inputField": "currentStateReadback",
      "source": "CURRENT_ACCEPTED_G2_CONTINUATION_STATE_READBACK",
      "requiredFields": ["source", "authoritative", "current", "complete", "readBack", "episodeId", "acceptedEpisodeAuthority", "candidateIdentity", "evidenceIdentity", "attemptState", "currentFailureSignature", "history", "effectReconciliation", "faithfulPathInventoryDigest", "digest"],
      "attemptFields": ["attemptCount", "attemptLimit", "productCorrectionAttempts", "productCorrectionLimit", "budgetConsumed", "budgetLimit"],
      "historyMustMatchExactly": true,
      "mustMatchIndependentAcceptedReadback": true
    },
    "requiredConditions": ["CONCLUSIVE_PRIMARY_OWNER", "PRODUCT_SEMANTICS_PROVEN_BAD_NO", "RECONCILED_EFFECTS", "FAITHFUL_PATH_REMAINS", "NO_EQUIVALENT_NO_PROGRESS_REPEAT", "SAME_ROOT_TRUST_AUTHORITY_SCOPE", "SAME_ASSURANCE_FLOOR_AND_EVIDENCE_BOUNDARY", "EXACT_CANDIDATE_AND_EVIDENCE_IDENTITY", "NO_ATTEMPT_OR_BUDGET_RESET", "AUTHORITATIVE_CURRENT_STATE_READBACK", "ACCEPTED_EPISODE_AUTHORITY_READBACK", "CONSUMPTION_WITHIN_ACCEPTED_LIMITS", "FAITHFUL_PATH_HAS_BOUND_EVIDENCE"],
    "effectReconciliation": {
      "requiredFields": ["source", "authoritative", "current", "complete", "readBack", "effects", "digest"],
      "acceptedEffectState": "RECONCILED",
      "independentReadbackField": "effectReconciliation",
      "mustMatchCurrentAcceptedStateReadback": true,
      "equivalentEffectOrderAllowed": true
    },
    "faithfulPathInventory": {
      "requiredFields": ["source", "authoritative", "current", "complete", "readBack", "paths", "digest"],
      "requiresRemainingFaithfulPath": true,
      "pathFields": ["pathId", "faithful", "available", "actualPath", "evidenceRef", "evidenceBoundaryId", "candidateIdentity"],
      "pathInventoryDigestBoundToCurrentState": true
    },
    "equivalenceFields": ["rootFamilyId", "unresolvedBlockerIds", "primaryOwner", "failedMechanism", "effectClass", "evidenceBoundaryId"],
    "equivalenceIgnoresLabels": ["runId", "workerId", "branch", "candidateIdentity", "episodeId"],
    "candidateTransition": "PRESERVE_EXACT_IDENTITY",
    "evidenceTransition": "PRESERVE_EXACT_IDENTITY",
    "attemptAndBudget": {
      "attemptCountMayDecrease": false,
      "budgetSpentMayDecrease": false,
      "limitsMayIncrease": false,
      "attemptCountMayExceedLimit": false,
      "productCorrectionsMayExceedLimit": false,
      "budgetConsumedMayExceedLimit": false,
      "overLimitResult": "RETURN_TO_WEB",
      "resetAllowed": false
    },
    "resultFields": ["admission", "violatedObligationIds", "candidateTransition", "evidenceTransition", "attemptEffects", "budgetEffects", "mutationEffects"],
    "replacementAuthority": {
      "observerSignature": "observe(policy, request, trustedContext)",
      "trustedContextFields": ["currentAuthority", "candidateReadback", "evidenceReadback"],
      "mustBeIndependentOfRequest": true,
      "mustNotBeSelectedByCallerLabelsOrDigests": true,
      "mustNotBeMutableThroughRequest": true,
      "currentAuthorityFields": ["source", "repository", "webAuthorityIdentity", "webAuthorityRevision", "webAuthorityContent", "episode", "run", "lock", "replacementPermission", "eligibleOwner", "correctionMechanism", "predecessorCandidate", "replacementCandidate", "pathEffectCeiling", "revalidationBoundary", "lifetime", "currentness", "permissionConsumption", "readBack"],
      "requiresExactCurrentReadback": true,
      "eligiblePrimaryOwners": ["HARNESS", "TOOLKIT", "ENVIRONMENT"],
      "eligibleCorrectionMechanisms": ["HARNESS_VALIDATION", "TOOLKIT_VALIDATION", "ENVIRONMENT_VALIDATION"],
      "episodeKind": "G3_RUN_LOCK",
      "permissionStateRequired": "AVAILABLE",
      "permissionUseCount": 1,
      "rejectStaleRevokedSupersededAuthority": true,
      "pathAndEffectMustStayWithinCeiling": true,
      "productAttemptDelta": 0,
      "budgetResetAllowed": false
    },
    "replacementCandidateValidity": {
      "requiredFields": ["repository", "kind", "objectFormat", "commit", "head", "tree", "orderedParents", "baseCommit", "commitTreeReadback", "lineage", "hostedBinding", "localCustodyBinding", "observedMutationScope", "predecessorPreservation", "revalidationLinkage"],
      "supportedKinds": ["HOSTED", "LOCAL"],
      "supportedObjectFormats": ["sha1", "sha256"],
      "headMustMatchCommit": true,
      "commitTreeReadbackMustMatch": true,
      "orderedParentsAndBaseMustMatchLineage": true,
      "repositoryEpisodePredecessorMustMatch": true,
      "hostedBindingFields": ["repository", "prNumber", "branch", "headSha", "baseCommit", "readBack"],
      "localCustodyBindingFields": ["repository", "custodyId", "worktreeId", "commit", "tree", "readBack"],
      "observedMutationScopeMustFitAuthorityCeiling": true,
      "predecessorEvidenceMustBePreserved": true,
      "evidenceReadbackMustBindCandidateAndRevalidation": true,
      "callerHashesAreEqualityAssertionsOnly": true
    },
    "replacementRejection": {
      "admission": "RETURN_TO_WEB",
      "candidateTransition": "NO_ACCEPTED_TRANSITION",
      "evidenceTransition": "NO_ACCEPTED_TRANSITION",
      "mutationEffects": []
    }
  }
}
~~~

### Canonical disposition vocabulary

A finding has exactly one current disposition and a separate lifecycle. Disposition answers what kind of work the evidence supports; lifecycle records whether that obligation remains unresolved. A disposition never grants mutation, ownership, scope, budget, dependency, merge or finality authority.

| Disposition | Meaning and timing |
| --- | --- |
| CURRENT_SHIP_BLOCKER | An admitted finding that satisfied every current-blocker predicate when classified; while UNRESOLVED, shipping the admitted current outcome is false, materially unsafe, or unassurable now. |
| IMMEDIATE_POST_SHIP | A concrete correction for the next post-ship opportunity that does not make the admitted current outcome or minimum floor fail now. |
| FUTURE_OWNED | A verified continuing owner and future home exist; the finding is deliberately outside the current outcome and remains unresolved until that owner closes or validly transfers it. |
| OBSERVE | Preserve a signal, trigger, or threshold for reassessment; no current correction is admitted without new evidence and Web adjudication. |
| EVIDENCE_ONLY | Acquire, preserve or verify evidence as a custody-only action; it neither asserts a product defect nor authorises product correction. Evidence acquisition does not resolve or discard the obligation; required evidence gates remain independently binding. |

`UNRESOLVED` and `RESOLVED` are lifecycle values, not dispositions. Resolving a finding never erases its original disposition, evidence, timing, owner, or closure proof.

### Lossless legacy projections

For consumers that still accept only the two-way or v1 vocabularies, project the canonical state as follows. The canonical disposition and lifecycle sidecar is mandatory: the projected label alone is not a lossless record.

| Canonical disposition | Lifecycle | Two-way projection | v1 projection |
| --- | --- | --- | --- |
| CURRENT_SHIP_BLOCKER | UNRESOLVED | SHIP_BLOCKER | BLOCKING |
| CURRENT_SHIP_BLOCKER | RESOLVED | SHIP_BLOCKER | RESOLVED |
| IMMEDIATE_POST_SHIP | UNRESOLVED | POST_SHIP | NON_BLOCKING |
| IMMEDIATE_POST_SHIP | RESOLVED | POST_SHIP | RESOLVED |
| FUTURE_OWNED | UNRESOLVED | POST_SHIP | NON_BLOCKING |
| FUTURE_OWNED | RESOLVED | POST_SHIP | RESOLVED |
| OBSERVE | UNRESOLVED | POST_SHIP | NON_BLOCKING |
| OBSERVE | RESOLVED | POST_SHIP | RESOLVED |
| EVIDENCE_ONLY | UNRESOLVED | POST_SHIP | NON_BLOCKING |
| EVIDENCE_ONLY | RESOLVED | POST_SHIP | RESOLVED |

Persist the complete canonical common finding record alongside either projection, including the admitted outcome, milestone, audience and environment; repository, packet, finding/revision, accepted decision and candidate; programme, child, frontier, Controller, contract and subject; timing, trigger, closure criterion and exact evidence; attribution, adjudication, disposition and lifecycle; and verified owner role/readback. The canonical record is authoritative: a transition disposition and source lifecycle repeated in transition input must agree with the record, including verified closure. Reject a contradiction under F1_RECORD_TRANSITION_CONSISTENCY before transition or effect. Reject missing applicable common fields under F2_COMMON_RECORD_COMPANION_COMPLETENESS. A resolved blocker still projects as `SHIP_BLOCKER` in the two-way field and as `RESOLVED` in v1; the sidecar preserves both its original class and lifecycle.

Nested identity composition is exact: PACKET_IDENTITY is an object with own nonblank string repository, packetId and packetRevision fields; its repository equals common REPOSITORY. CANDIDATE_IDENTITY is an object with own nonblank string commit and tree fields. Preserve these exact nested identities across the canonical record, owner readback, companion projection, current inventory, closure readback and blocker admission. Transfer also requires a separate independently anchored current ownership readback. Hashes and digests bind bytes but never establish authority. For every rejected transition request, including early validation returns, return ok=false, transition=null, mutationEffects=[], and the canonical record's DISPOSITION and LIFECYCLE; request values never select the resulting state.

Every coarse row carries a content-addressed DETAIL_REF to exactly one complete companion record; consumers recompute its canonical record digest. Every applicable current or historical record carries the complete common semantic context. Each companion projection binds repository, packet, finding/revision, candidate, accepted decision and the complete admitted outcome object (outcome, milestone, audience and environment); hashes and coherent caller rebinding cannot replace current authoritative context. Every current companion row and its complete inventory must be read back from the current authoritative Web admission source, with the inventory digest binding every exact record and reference. The independent contract interpreter checks every declared field type and rejects missing, duplicate, swapped, altered or contradictory records even when caller-supplied hashes are recomputed. For CURRENT_SHIP_BLOCKER, the same hashed record contains every blocker field and nested proof value, and admission binds each proof field to that exact record and Web-admitted DETAIL_REF. At most one current disposition is admitted for each repository, accepted packet, finding, Web-admitted revision and candidate identity; FINDING_REVISION and ACCEPTED_DECISION_ID remain bound in each record and projection but do not create another current uniqueness slot. Historical evidence remains immutable and append-only: the complete ledger digest is read back from the CURRENT canonical parent contract, every retained record is content-addressed, and an existing record and digest are never rewritten; later state receives a new Web-admitted revision and DETAIL_REF.

### Current blocker field contract

Current-blocker admission is conjunctive. Every row below must be present, exact, evidence-backed, and admitted by Web for the revision being decided. The effect set is exactly {FALSE, MATERIALLY_UNSAFE, UNASSURABLE}. ALL_FIELDS_REQUIRED=YES.

| Required field | Bound value or proof |
| --- | --- |
| WEB_ADMITTED_REVISION | Exact durable Web-admitted revision for the current decision; it binds the accepted outcome, milestone, audience, supported environment, timing and current authority. |
| ADMITTED_CURRENT_OUTCOME | The exact non-empty outcome id, milestone, intended audience and supported environment admitted for this shipment. |
| LOCKED_CRITERION_OR_FLOOR | Exact locked acceptance-criterion identifier or applicable minimum-safety-floor obligation; no criterion is invented from a suggestion or severity label. |
| SHIP_NOW_CONSEQUENCE | Concrete, evidence-backed consequence of shipping the current candidate against that criterion or floor. |
| REQUIRED_OUTCOME_EFFECT | One demonstrated effect in {FALSE, MATERIALLY_UNSAFE, UNASSURABLE} on the admitted current outcome or minimum floor. |
| SAFE_DEFERRAL_IMPOSSIBLE | Evidence showing why an existing or newly verified future owner cannot safely close the finding later while the current outcome remains correct and assurable. |
| SMALLEST_CORRECTION | The smallest correction that closes the demonstrated current failure; any correction outside accepted authority or scope returns to Web for decision. |
| VERIFIABLE_CLOSURE | A falsifiable closure oracle at the relevant consequential boundary, including the required positive control where applicable. |
| EXACT_EVIDENCE | Durable exact evidence references for the observed failure, current consequence, deferral analysis and closure oracle. |
| CANDIDATE_IDENTITY | Exact object with own nonblank string commit and tree fields, identifying the accepted immutable candidate to which the evidence applies. |
| REPOSITORY | Exact canonical repository identity shared by the accepted packet, finding, candidate and current Web decision. |
| PACKET_IDENTITY | Exact object with own nonblank string repository, packetId and packetRevision fields; repository equals REPOSITORY, and the identity remains bound to the programme, child, frontier and accepted contract. |
| FINDING_REVISION | Exact immutable finding revision evaluated by the accepted decision. |
| ACCEPTED_DECISION_ID | Exact current Web-admitted decision identifier bound to this finding and candidate. |
| PROGRAMME_ID | Exact parent programme identity for this accepted finding. |
| CHILD_ID | Exact delivery-child identity that owns the accepted work. |
| FRONTIER_ID | Exact dependent current frontier whose outcome is evaluated. |
| CONTROLLER_ID | Exact controller decision identity for the current admission. |
| ACCEPTED_CONTRACT_ID | Exact accepted contract identifier governing required behavior and closure. |
| SUBJECT_ID | Exact subject identity bound to the finding and accepted candidate. |
| OBSERVED_BEHAVIOR | Evidence-backed observed behavior for this exact subject and candidate. |
| REQUIRED_BEHAVIOR | Exact accepted behavior required by the locked criterion or floor. |
| PRIMARY_OWNER | Exact canonical primary-owner identity retained with the finding. |
| ATTRIBUTION | Exact accepted causal or learning attribution for this finding, preserved separately from its disposition and lifecycle. |
| ADJUDICATION | Exact Web-admitted disposition assigned to this finding revision. |
| OWNER_ROLE | Exact role held by the verified continuing owner for this obligation. |
| OWNER_READBACK | Current authoritative readback bound to every applicable common-record value: repository, packet, finding/revisions, accepted decision and complete admitted outcome; programme/child/frontier; timing, trigger, closure and exact evidence; Controller/contract/subject/candidate; attribution, primary owner, adjudication, disposition and lifecycle; verified owner, owner role and resolution. Transfer compares the complete requested record and embedded readback with a separate, non-aliasing current authoritative ownership-state readback; caller-rebound values and recomputed digests do not authorize transfer. Transfer leaves lifecycle UNRESOLVED. |
| RESOLUTION | Exact lifecycle resolution state; transfer or deferral alone remains unresolved. |

Initial admission rule: DISPOSITION=CURRENT_SHIP_BLOCKER, LIFECYCLE=UNRESOLVED, and every declared field is required. Every scalar identity, outcome, owner, timing, criterion, correction and closure value is a non-empty string; evidence references are non-empty arrays of non-empty unique strings; nested outcome, consequence, deferral and closure records have exactly their declared fields and types. The full common finding record and every blocker-specific field must be present, non-empty, mutually consistent and bound to the exact candidate, accepted outcome, criterion/floor, durable evidence and Web-admitted revision. The decision itself must be read back from the current authoritative Web admission, and its exact body digest binds the complete decision including the detailed companion reference. Web durably reconciles the full predicate against that exact identity. Resolution changes only lifecycle to RESOLVED after an authoritative, current Web closure readback binds the complete canonical common record, including the admitted outcome, milestone, audience and environment, and verifies the exact finding, admitted disposition, closure criterion, evidence references, candidate identity and transition; a caller-supplied criterion, evidence label or recomputed digest alone cannot resolve work. Resolution retains the admitted disposition and evidence. Deferral, evidence acquisition or ownership transfer never resolves an unfinished obligation; an ownership transfer binds the complete current finding record and authoritative readback while `RESOLUTION=NOT_RESOLVED` on both sides. Severity, novelty, a G4 label, a critical evidence gap by itself, or a prior blocker label cannot substitute for any field. If any field is missing or contradictory, do not admit this disposition; preserve the unresolved evidence/hold obligation under its proper type, and keep independent required gates binding.

### Current-frontier effect and examples

Only a properly admitted, unresolved `CURRENT_SHIP_BLOCKER` may block the finding-derived dependent current frontier. Its dependency must be explicit and limited to the work that cannot safely proceed without closure. It cannot suppress or replace independent CI, assurance, authority, evidence, checkpoint, or other accepted gates. Every non-blocking disposition retains its evidence and required continuing owner/trigger; it cannot widen current mutation scope, budget, prerequisite graph, or authority.

| Example | Evidence result | Disposition |
| --- | --- | --- |
| An alpha edge is safely deferrable to its verified future owner and does not violate an admitted current criterion or minimum floor. | Safe deferral is demonstrated; current outcome remains correct and assurable. | FUTURE_OWNED |
| An admitted alpha journey has a demonstrated data-integrity or safety-floor defect and every required predicate above is satisfied for the exact candidate and Web-admitted revision. | Shipping now is false, materially unsafe, or unassurable; safe deferral is impossible and closure is verifiable. | CURRENT_SHIP_BLOCKER |

### Post-child integrated dual review

Only a current canonical merge/event and child-state readback identifying the final Delivery Child merge triggers deterministic reconciliation; a caller label cannot suppress it. Supporting or incremental PRs do not trigger a child checkpoint. The only assurance modes are `RECONCILE_ONLY` and `DUAL_MAX`; `SINGLE_MAX` does not exist. Read and validate shared prerequisites before mode selection: exact integrated commit/tree and merge receipt, current canonical parent and child state, complete terminal-receipt membership, complete applicable merge-check membership, and coherent finality/dependency state. Every trigger and reconciliation predicate must have explicit current proof; missing or contradictory proof is `HOLD`, never false. Validate the child, check and review inventory shapes before dereferencing them; a missing or malformed inventory is `HOLD`. Selecting `RECONCILE_ONLY` never bypasses a missing or stale shared prerequisite.

`RECONCILE_ONLY` is valid only when the exact merge tree equals the assured/accepted child tree; no unassured concurrent or multi-child composition or conflict-resolution semantic delta exists; child terminal/finality and parent CURRENT/frontier/dependencies are coherent; no material dependent finding is unresolved; applicable merge-check membership is complete and every applicable check is terminal green; no explicit dual requirement applies; and the child is not final. Controller or Architecture edits alone are not a `DUAL_MAX` trigger.

Select `DUAL_MAX` for an integration-tree delta, unassured concurrent/multi-child composition, material root/trust/authority integration outside the assured tree, unresolved integration uncertainty, explicit Owner/Web/G4 requirement, or the final Delivery Child. A tiny but unassured trust/finality interaction still requires `DUAL_MAX`. Both independent read-only review slots are required against the same immutable post-merge snapshot and remain mutually blind until both reports are terminal. If either reviewer is unavailable, HOLD; there is no one-review fallback. The final child always takes `DUAL_MAX`.

Derive expected merge-check membership from a complete current authoritative configuration readback, event/branch/path conditions, child-required checks, every enabled applicable first-party merge-triggered check (including checks not separately marked `requiredAtMerge`). First-party ownership comes from the current authoritative configuration metadata, not a finite local producer allowlist. Bind the producer-authority classification and the pre-result membership freeze point. Bind the configuration and terminal-run sources, event/trigger/head, premerge-only versus merge-triggered rule, missing-check rule, latest-run rule, and not-applicable rule before examining results. Every producer, workflow, revision, check, matrix leg, event, trigger and head identity is required and must bind the exact integrated event; the selected run must be the current terminal run for that identity. Bind the same expected check identities across configuration, canonical child inventory, terminal result inventory and review snapshot. A provably empty expected membership is valid only when the complete authoritative configuration readback and those inventories agree that it is empty. Greens-only membership, co-omitted expected checks, wrong producers, missing identity fields, skipped/cancelled/failed dependencies treated as not applicable, ambiguous matrix expansion, stale successful reruns/predecessors, or newly applicable configuration after freeze do not produce a green reconciliation.

This law applies only to explicitly Toolkit-managed repositories. Read back the exact merged identity and the relevant current or terminal child state from their canonical sources; both readbacks must be authoritative, current and explicit. The CURRENT canonical parent programme contract is an authoritative input to both reviews. Read back its exact body and verify its body digest against those bytes. Before mode selection, read back the complete required receipt IDs and applicable integration-check membership from the current canonical child state. Bind those stable IDs, exact integrated identity, and parent/child state revisions and digests to one immutable review snapshot. Do not bind terminal-status digests into that launch snapshot. When `DUAL_MAX` is selected, read back current Owner/Web reviewer-route authority and bind the exact route to that same immutable snapshot before starting both reviews. When `DUAL_MAX` is selected, start both independent whole-programme reviews alongside merge-triggered CI; CI and reviews may finish in either order. For `DUAL_MAX`, after both reports return, read back the complete terminal object-receipt inventory from its canonical ledger and the complete applicable integration-check inventory from its canonical source. Individually read back each receipt and applicable check. When `DUAL_MAX` is selected, both reports, terminal receipts and all applicable checks must be terminal before Web adjudication.

The route for each `DUAL_MAX` review is supplied by current Owner/Web authority and is not an authoritative default or permanent Architecture route law. Record the exact provider/model/reasoning bindings from that current readback. Both reviews are independent, read-only whole-programme reviews. Each reviewer receives the same accepted scope and evidence but neither sees the other's report before both reports are returned to Web. A missing route or unavailable reviewer under `DUAL_MAX` is a typed hold/Web decision; there is no silent route substitution.

Web adjudicates both reports against the exact integrated identity and current parent/child inputs. Do not copy programme-wide parent law into every child. The checkpoint may block only a dependent next-child frontier; unrelated authorised lanes continue. The final integrated programme review occurs at the final Delivery Child checkpoint for this lifecycle. It is not per-commit G4 and does not replace pre-merge G4 or a separately required Final Audit. Web retains all merge, programme and finality authority.

### Bounded non-product continuation

A bounded non-product continuation may recover an accepted evidence path within the exact current G3 RUN/Lock, a parent-owned already-authorised LIGHT operation, or any other currently accepted Web-bounded evidence episode recorded by its authoritative readback. G3 and LIGHT are examples, not an exclusive episode set. It requires conclusive primary attribution to HARNESS, TOOLKIT, ENVIRONMENT, VALIDATION_CARRIER, or TRANSPORT and PRODUCT_SEMANTICS_PROVEN_BAD=NO. PRODUCT or UNKNOWN never grants autonomous continuation, and PRODUCT_SEMANTICS_PROVEN_BAD=YES is not product-correction authority. The current episode authority, primary owner, semantics, root, trust model, scope, assurance floor and accepted evidence boundary remain exact. The episode kind and primary owner must match the independently accepted current Web authority readback. A complete current accepted-G2 state readback binds the exact episode authority and owner, candidate and evidence identities, attempt and budget counters and limits, current failure signature, faithful-path inventory digest, and full continuation history. Omitted, stale, partial or caller-rebound authority, history, identities, counters or limits return to Web. Attempt, product-correction and consumed-budget counts may not exceed their accepted limits; any over-limit count returns to Web. Independently reconcile effects and faithful-path inventory; an unreconciled effect or exhausted faithful path returns to Web. A remaining faithful path must have an exact non-empty path identity, actual path and evidence reference bound to the accepted candidate, evidence boundary and independent accepted-state inventory digest; missing or caller-rebound path evidence returns to Web. Identity-preserving recovery keeps the exact candidate and evidence identities, and every candidate remains immutable. Repeated materially equivalent no-progress history returns to Web even when run, worker, branch or candidate labels change.

For a published/hosted candidate, only the existing explicitly Web-authorised hosted non-product reclosure may create a distinct immutable replacement candidate in the same RUN/Lock/G3 episode. That exception requires primary owner HARNESS, TOOLKIT, or ENVIRONMENT; PRODUCT_SEMANTICS_PROVEN_BAD=NO; unchanged product semantics, root/trust, accepted G2 contract and assurance floor; and correction bounded to the exact validation/harness/tooling/environment mechanism. Preserve the failed candidate as durable evidence, bind the replacement's new commit/tree and exact revalidation boundary, consume no product/G3 correction attempt, and reset no budget. This is hosted validation reclosure, not local pre-publication product correction. TRANSPORT-only recovery does not use this replacement-candidate exception without separate explicit Web authority.

The replacement observer receives observe(policy, request, trustedContext). Its independently supplied trustedContext.currentAuthority, candidateReadback, and evidenceReadback are separate from the request and remain unchanged when request fields are mutated. Caller-selected labels and caller-recomputed hashes or digests are equality assertions only; they never select or establish authority. The current authority readback binds the exact repository; Web authority identity, revision and content; episode, RUN and Lock; one-use replacement permission; eligible non-product owner and correction mechanism; predecessor and exact replacement candidate; path and effect ceiling; exact revalidation boundary; and authority lifetime, currentness, revocation, supersession and permission-consumption state. A stale, revoked, superseded or already-consumed permission returns to Web.

The independent candidate readback binds repository, HOSTED or LOCAL kind, object format, non-empty commit/head/tree identities, ordered parents, base commit, exact commit-to-tree readback, predecessor/base/parent lineage, kind-specific hosted PR/branch/head or local custody, observed mutation/effect scope, predecessor preservation and exact revalidation linkage. HOSTED and LOCAL bindings cannot be substituted for each other. Independent evidence readback must bind the exact replacement candidate, preserved predecessor evidence and revalidation boundary. A rejected replacement produces no accepted candidate transition, no accepted evidence transition and no CREATE_DISTINCT_WEB_AUTHORISED_REPLACEMENT effect, even when another helper condition succeeded. These source-policy fixtures model independently captured authority and Git/readback evidence; they do not perform live Git or GitHub verification and do not claim runtime enforcement.

Neither path grants product correction or aliases a replacement under an old identity. It does not widen the existing authority, mutation boundary, accepted scope/floor or prerequisite graph, grant a new continuation, reset a budget, shop outcomes, or decide PASS/merge/finality. A product RED follows ordinary G3 correction with immutable candidate handling. Material semantic, authority, scope, floor or evidence-contract ambiguity, unknown ownership, or repeated materially equivalent non-product RED without material progress returns to Web through the existing typed decision path.

### Faithful validation carrier

Treat the carrier inventory as an authoritative current readback, not caller-supplied availability. A carrier is an execution substrate, not one dedicated test application per repository; app/service lifecycle or topology matters only when the accepted validation criterion requires it. Select faithful local/dev first, then reconcile suitable existing Owner-authorised execution infrastructure, and provision or expand only after that reconciliation proves necessity. Bind the selected carrier identity and actual path to the candidate, accepted criterion, accepted execution path, enforcement boundary and required terminal execution/readback evidence. The default carrier remains PRIVATE/NONPUBLIC without domain registration, DNS or public ingress. Persistence does not imply exposure. Public ingress is admissible only when a specific accepted validation criterion requires it and a current authoritative Owner/Web readback binds the exact exposure and public request, including consumer, protocol, path, hostname requirement and hostname, accepted criterion, necessity, audience, boundary, lifetime and cleanup. If domain registration or DNS is required, each operation needs its own current authoritative Owner/Web readback bound to that exposure with a distinct authority reference; one combined grant is insufficient.

A carrier is faithful only when independently bound read-back evidence contains a terminal execution receipt from an actual invocation of the selected carrier path and accepted production path, and binds that exact carrier identity, accepted criterion, immutable candidate and enforcement boundary to its ordered run events and execution-evidence digest. Source-policy regression fixtures may model such a verified receipt but do not execute or qualify a carrier. Caller-supplied labels, hashes, mocks, fixtures or indirect observations do not establish runtime boundary exercise. If no such evidence is available within authority, report incomplete evidence or a typed HOLD.

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
