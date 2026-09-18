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

## Gate lifecycle

### G1 — Architecture and authority

G1 establishes:

- outcome and scope;
- architecture and authority boundaries;
- risk/assurance path;
- dependencies;
- child sizing and whether work must split.

Toolkit G1 must prove conformance to this document or explicitly obtain authority to amend it.

### G2 — Executable implementation contract

G2 binds:

- acceptance criteria and invariants;
- affected consumers;
- permitted effects;
- validation and evidence requirements;
- reversal/recovery behaviour;
- correction limits.

G1 and G2 are decisions, not mandatory separate conversations. Where one accepted design invocation can truthfully establish both under current routing/authority, separate model launches are unnecessary.

### G3 — Implementation and validation

G3 implements and validates the complete bounded child candidate within the accepted contract.

Ordinary commits or internal increments do not create separate G4 lifecycles.

Material scope expansion stops the affected work at a safe boundary and returns to Web for amend/split/replan authority.

### G4 — Child-final independent assurance

G4 is fresh, isolated, read-only assurance of the **complete final Delivery Child candidate** and its relevant dependency boundaries/evidence.

G4 is not an automatic review of every commit or internal increment.

Web retains merge and child-finality authority after exact candidate, base, checks, findings, authority and required evidence are reconciled.

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

- bounded implementation defect within accepted contract -> correct in the same child/PR, rerun affected validation, then fresh G4;
- executable-contract defect with architecture intact -> re-enter affected G2;
- architecture, authority or child-boundary defect -> hold and re-enter G1/replan/split;
- provider, route, authentication, check-system or evidence-availability problem -> typed HOLD, not an implementation correction;
- non-blocking improvement -> retain one durable continuing owner without prolonging a safe candidate.

Retain at most two material correction attempts per implementation lineage.

One correction attempt is a coherent correction batch following an accepted material verdict, not each finding, commit or test run.

Before returning to G4, inspect materially equivalent paths and retain semantic regressions for the accepted defect family.

Renaming a child, branch, PR, contract or lineage label does not reset exhausted work.

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

- compact typed decision record containing every material finding, qualification, unresolved risk and disposition;
- immutable evidence manifest containing identity, binding, custody/retrieval information and required consumers;
- supporting evidence retained under the authorised policy and fetched by consumers that actually require it.

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
- next admissible action.

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
