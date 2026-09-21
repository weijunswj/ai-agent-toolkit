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

- `G0-A` = bounded problem framing; leaf-only, read-only and conditional for genuinely simple/well-specified work.
- `G0-B` = bounded evidence acquisition; the subagent-capable phase of the single non-gating G0 stage.
- `G1` = root convergence plus architecture/authority.
- `G2` = adversarial executable implementation-contract closure.
- `G3` = implementation/validation.
- `G4` = fresh isolated exact-head independent assurance.
- `LOOP`, `RECONVERGENCE`, `FINAL_AUDIT` and `BROWSER` are named execution roles outside the G1-G4 decision sequence. RECONVERGENCE is read-only and non-gating.

Only G0-B and G3 may use semantic depth-1 subagents. All spawned subagents are leaf-only. G0-B fan-out is read-only evidence acquisition; G3 fan-out must remain inside the accepted G2 separation/mutation contract.

Concrete provider/model/reasoning choices are selected through an explicitly named stack registry binding and are configuration, not architecture law. There is no authoritative default stack. Service treatment/speed is non-authoritative observed metadata. A route change that preserves these stage semantics and authority boundaries does not require an architecture redesign.

## Gate lifecycle

### G0 — Problem framing and evidence acquisition

G0 is non-gating and may use two chronological phases.

G0-A frames uncertain/diagnostic work: known facts, contradictions, material unknowns, competing hypotheses, discriminating evidence questions and the stopping condition for sufficient evidence. G0-A is leaf-only. A separate G0-A model invocation may be omitted or compacted for genuinely simple/well-specified work.

G0-B acquires the evidence requested by the framing packet and may fan out bounded depth-1 read-only leaves for genuinely separable questions. Leaves collect evidence rather than independently redesigning the solution. G0-B may be omitted when existing evidence is already sufficient.

### G1 — Root convergence, architecture and authority

For material uncertain work, G1 establishes:

- outcome and scope;
- a supported bounded causal/root model explaining the material observations;
- material competing hypotheses and their disposition;
- governing invariant and trust/authority ordering;
- materially equivalent surfaces inside the defect/risk class;
- architecture and authority boundaries;
- risk/assurance path;
- dependencies;
- child sizing and whether work must split;
- remaining assumptions and evidence that would invalidate them.

Material unresolved root uncertainty produces HOLD with a specific missing-evidence request rather than a speculative PASS.

Toolkit G1 must prove conformance to this document or explicitly obtain authority to amend it.

### G2 — Adversarial executable implementation contract

G2 independently challenges the accepted G1 boundary before mutation. It may inspect primary sources and reject a flawed G1 assumption.

G2 binds:

- acceptance criteria and invariants;
- consequential entry/copy/serialization/consumer boundaries;
- affected consumers;
- permitted and forbidden behaviour;
- positive, negative and adversarial regression oracles;
- validation and evidence requirements;
- reversal/recovery behaviour;
- correction limits.

For material difficult/diagnostic/security/authority-sensitive work, G2 should use a fresh context and ask how an implementation could satisfy the proposed instructions while still violate the accepted invariant.

For expressly simple/low-uncertainty work, one invocation may establish logically separate G1 and G2 decisions when current routing/authority permits it; record the absence of a fresh independent-model challenge.

### G3 — Implementation and validation

G3 implements and validates the complete bounded child candidate within the accepted contract and demonstrates closure at actual consequential/public boundaries, not only helper-level tests.

Ordinary implementation choices inside the contract remain G3 work. A discovery that changes the governing invariant, trust boundary or material contract HOLDs for the appropriate re-entry.

Ordinary commits or internal increments do not create separate G4 lifecycles.

Material scope expansion stops the affected work at a safe boundary and returns to Web for amend/split/replan authority.

### G4 — Child-final independent assurance

G4 is fresh, isolated, read-only assurance of the **complete final Delivery Child candidate** and its relevant dependency boundaries/evidence.

G4 remains adversarial; upstream convergence must improve first-pass quality without weakening G4.

A material G4 finding may record one primary learning classification: `G1_ROOT_MODEL_MISS`, `G2_CONTRACT_COVERAGE_MISS`, `G3_IMPLEMENTATION_MISS`, or `G4_NOVEL_EDGE_CASE`. Classification is diagnostic evidence, not a score or authority grant.

G4 is not an automatic review of every commit or internal increment.

Web retains merge and child-finality authority after exact candidate, base, checks, findings, authority and required evidence are reconciled.

### Re-convergence

RECONVERGENCE is a read-only non-gate role used only after bounded focused recovery fails to converge at the same/root-related boundary.

Its result is `CONTINUE_CURRENT_CONTRACT`, `G2_REENTRY_REQUIRED`, `G1_REENTRY_REQUIRED`, `OWNER_DECISION_REQUIRED`, or `NONCONVERGED`. It grants no authority. `CONTINUE_CURRENT_CONTRACT` is actionable only when existing authority, budgets and fresh state already permit the named correction; `NONCONVERGED` becomes `LOOP_NONCONVERGENCE_OWNER_REQUIRED`.

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

### Delivery Child lifecycle and non-convergence

A Delivery Child is the durable owner of its admitted outcome until one of two explicit terminal dispositions occurs:

- **completed** — its required acceptance/finality has been achieved and its terminal disposition is durably recorded; or
- **superseded/retired by Owner/Web** — an explicit current Owner/Web decision changes the child topology/lifecycle and identifies the durable continuing owner for every still-required obligation.

Normal execution events do not imply either disposition. In particular, worker failure/replacement, HOLD, G4 AMEND, route/provider/evidence blockage, implementation non-convergence, or exhaustion of the current implementation-lineage correction budget must leave the existing child open/current or held unless Owner/Web explicitly decides otherwise.

Correction-budget exhaustion remains visible and terminal for the ordinary correction allowance of that implementation lineage. It requires Owner/Web adjudication. A new implementation lineage or new flat Delivery Child is valid only when justified by a material architecture/authority or independently shippable/reversible boundary and explicitly accepted; it must never be created merely to reset correction accounting. The bounded reconverged-correction exception above is the only same-scope post-exhaustion corrective path and is never automatic.

Repository Loop bounded-convergence/anti-bounce rules govern executor and diagnostic persistence inside the existing child. After one focused diagnosis/recovery, a repeated same/root-related HOLD may invoke one read-only Re-convergence synthesis. Re-convergence may resume an already-authorised correction or identify the smallest G2/G1/Owner decision boundary; it cannot close/retire/supersede/replace/transfer the child or reset/expand correction or mutation budgets. `NONCONVERGED` becomes `LOOP_NONCONVERGENCE_OWNER_REQUIRED`.

## Roles

- **User/Web** — architecture, material scope/risk/authority changes, topology decisions, waivers, consequential authority and finality.
- **Loop Manager** — deterministic/reconciled progression of already-authorised work; no silent scope or authority expansion.
- **Worker/executor** — implementation or bounded analysis; no ownership/finality authority.
- **Deterministic runtime** — state, admission, routing, identity, recovery, publication/readback and safety enforcement.

The Loop should automate the simple delivery system, not preserve obsolete process complexity.

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

- compact typed decision record containing every material finding, qualification, unresolved risk, disposition, exact identity and other fact needed for the receiving Loop/Web decision;
- immutable evidence manifest containing identity, binding, custody/retrieval information and required consumers;
- supporting evidence retained under the authorised policy, with external retrieval used only where the accepted contract guarantees access by the intended consumer.

A producer must not assume that Web, Loop or another later consumer has its filesystem, shell, session/process state, hidden logs, host-only tools, or independent ability to refetch/recompute missing facts. Decision-relevant content required for immediate adjudication travels in the terminal packet. Pointers and retrieval instructions are supplementary, not substitutes.

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
