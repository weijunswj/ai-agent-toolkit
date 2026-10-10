# Programme Discovery Baseline Convention

This is a bounded, non-secret evidence convention for programme discovery. It is not architecture authority, a gate, programme state, a runtime, an agent, a route registry, or a secret store. The consuming child owns its applicability decision and exact `DISCOVERY_BASIS` receipt. A baseline may support that decision but does not make it.

## Basis selection

Use exactly one `DISCOVERY_BASIS` value for the consuming child:

- `REUSE`: unchanged findings remain applicable by exact identity; issue a bounded applicability receipt without dedicated work merely to restate them.
- `DELTA`: changed/new material facts are investigated; invalidate only findings whose dependencies or triggers changed.
- `ADOPTED_EQUIVALENT`: adequate existing investigation is adopted by exact source, revision, and evidence identity.
- `FULL`: optional `G_FRAME` -> programme-scope read-only `G0` -> `G1` -> exact Web acceptance. A new chat/day/worker/takeover/task alone is not a trigger. Discovery has no local `G2/G3/G4` merely for investigation.

A material dependent decision that relies on real workflow behaviour requires representative enactment when safe, authorised enactment exists. `OBSERVED` requires a current authoritative observation readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and changed facts, plus a safe evidence/reverification reference and current terminal enactment receipt bound to the operation authority. G0 remains read-only. Effectful probes require current X3/Web authority bound to the exact consuming repository, programme, child, baseline revision and operation. If safe enactment is unavailable, preserve `UNKNOWN` or `DOCUMENTED_NOT_DEMONSTRATED` and a disposition; do not claim an observed result. `ACCEPTED` requires a current authoritative G1/Web decision readback binding repository, programme, child, baseline/finding revision, exact evidence identities, outcome, body and digest. A caller-supplied decision ID or digest alone is not authority.

## Bounded record shape

Every baseline includes:

```text
BASELINE_ID
BASELINE_REVISION
PROGRAMME_ID
SCOPE
SOURCE_IDENTITIES[]
FINDINGS[]
```

Each finding includes:

```text
FINDING_ID
CLAIM_OR_SUBJECT
STATUS
OBSERVATION_CONTEXT
SAFE_EVIDENCE_OR_REVERIFY_REFERENCE
DEPENDENT_IDENTITIES[]
INVALIDATION_TRIGGERS[]
CONSUMING_DECISION_IDS[]
AUTHORITATIVE_SOURCE_READBACK
SUBJECT_TYPE
INTERFACE_SUPPORT
VOLATILITY
```

`STATUS` is exactly one of `OBSERVED`, `DOCUMENTED_NOT_DEMONSTRATED`, `INFERRED`, `PROPOSED`, `UNKNOWN`, or `ACCEPTED`.

Source identities and evidence references must identify a safe re-verification path: repository/path/revision, public URL and retrieval date, or an authorised custody reference that its intended consumer can resolve. A digest by itself is not a recoverable private-evidence reference. `REUSE` requires a current applicability receipt bound to the exact consuming repository, programme, child identity/revision and baseline identity/revision, plus reused finding identities, checked dependencies and invalidation triggers; it cannot be replayed across consumers. `DELTA` requires a complete current dependency/finding inventory bound to that same consumer scope and mapping every changed material fact before local invalidation; missing or partial mapping is HOLD. Adoption requires a current applicability readback bound to the exact consuming repository, programme, child revision, baseline revision, finding IDs and covered material facts; source identity or caller-supplied adequacy alone is insufficient. Acceptance requires an independently read-back, current authoritative G1/Web decision bound to exact identities and evidence. Raw private material always invalidates repository admission, even if a custody reference is also present. Keep private evidence in its authorised custody. Never place raw private evidence, customer data, credentials, cookies, tokens, session material, or secret-bearing URLs in a repository baseline. Cross-repository imports bind exact source/revision/evidence identity, are sanitised, and import no source or mutation authority.

## Sanitised examples

These examples are illustrative and contain no real programme or private evidence.

### REUSE

```text
DISCOVERY_BASIS=REUSE
BASELINE_ID=EXAMPLE-BASELINE-01
BASELINE_REVISION=4
REUSED_FINDINGS=[F-LOGIN-CONTRACT-01]
APPLICABILITY_CHECK=dependencies unchanged; no listed invalidation trigger fired
DEDICATED_DISCOVERY=NONE
```

### DELTA and local invalidation

```text
DISCOVERY_BASIS=DELTA
CHANGED_FACT=visible settings panel moved in source revision example:rev-18
INVALIDATE=[F-SETTINGS-PANEL-01]
REUSE_UNCHANGED=[F-LOGIN-CONTRACT-01]
NEW_FINDINGS=[F-SETTINGS-PANEL-02]
```

Only findings that depend on the changed panel are invalidated; baseline age does not expire unrelated findings.

### ADOPTED_EQUIVALENT

```text
DISCOVERY_BASIS=ADOPTED_EQUIVALENT
SOURCE=repo:example/recon/path=docs/recon.md@revision=example:rev-7
EVIDENCE_ID=example-evidence-opaque-12
SANITISATION=reviewed; no private payload included
```

### FULL

```text
DISCOVERY_BASIS=FULL
PATH=optional G_FRAME -> programme-scope read-only G0 -> G1 -> exact Web acceptance
TRIGGER=material unknown workflow and interface behaviour
```

### Private-evidence reference

```text
SAFE_EVIDENCE_OR_REVERIFY_REFERENCE=owner-custody:opaque-ref-07
CUSTODY_RECEIPT=authority-bound and recoverable by the named decision consumer
REPOSITORY_CONTENT=reference only; no evidence bytes, URL credentials, or session values
```

### UNKNOWN when enactment is unsafe

```text
STATUS=UNKNOWN
OBSERVATION_CONTEXT=actual external submit would create an unauthorised side effect
SAFE_EVIDENCE_OR_REVERIFY_REFERENCE=public documentation reference or none available
DISPOSITION=defer the dependent decision to Owner/Web; request X3 authority only if enactment is necessary
```

## Invalidation and review

Re-evaluate a finding when a listed dependency changes, an invalidation trigger fires, its source/revision is no longer retrievable, or the consuming decision changes materially. Invalidate locally by finding identity; do not expire the whole baseline because one finding is stale. Record the affected consuming decision IDs and the new evidence identity. An imported finding remains evidence from its source and cannot become architecture or mutation authority through adoption.
