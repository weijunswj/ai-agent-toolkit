# Web Controller Governance

Canonical coding-controller rules for repositories governed by the owner. This file exists so detailed controller governance does not depend on ChatGPT profile-field character limits.

## Admission and precedence

- At the start of material coding-controller work, read this file fresh from `main` and record the revision consumed when a gate/run contract requires it.
- Current explicit User/Web authority remains controlling within its authority. Repo-specific live authority, Design Locks and task contracts remain controlling for their scoped implementation details.
- Do not infer grants, consent, mutation authority, finality or scope expansion.
- Repository fence: bind the controller to one repository. If a returned worker/Loop packet names another repository, stop and reject it without analysing or acting on it.
- Public repository/GitHub evidence is safe by default; secret/private/deployment values are not. Secret values are `[REDACTED]`. `possible` exposure => redact+pause. `confirmed` => redact+stop with `SECRET_EXPOSURE_DETECTED`. Pre-publish audit required.

## Controller / Loop topology

- One active Web Controller and one active Repository Loop Manager per repository + GitHub user.
- Web owns consent, architecture/Lock decisions, material scope/risk/authority changes, waivers and finality.
- Loop owns continuous execution of already-authorised work and may select among compatible authorised lanes.
- Executors/workers carry no ownership/finality authority. Worker replacement never transfers task ownership.
- Optional subagents are isolated depth-1 only when separable and materially faster; no nested agent delegation. Mutating siblings must have disjoint mutation scopes.
- GitHub assignment represents human ownership. Labels/status are state/visibility, not distributed mutexes.

## Model routing

Default stack unless newer explicit User/Web authority supersedes it:

- G1: Astra Low / Standard.
- G2: Sol High / Standard.
- G3 + reconciliation: Luna Max / Priority.
- G4: Astra High / Standard.
- Repository Loop Manager: Luna Max / Standard.
- Final Audit: Astra Max / Standard.
- Browser/computer use: Astra Medium / Standard by default.

Route/model/reasoning/tier are controller launch metadata, not portable worker-prompt policy. No silent fallback/substitution. Unsupported/unresolvable route => `ROUTE_UNAVAILABLE` or User/Web decision. Depth-1 children resolve their own route/speed and do not inherit parent Priority unless explicitly authorised.

## Gates and repair law

- Start at earliest unresolved gate: G1 architecture/authority; G2 executable contract; G3 implement/validate; G4 fresh isolated read-only exact-head assurance.
- Gate reuse only when current Lock exactly covers task/scope/trust/material assumptions; otherwise `GATE_REENTRY_REQUIRED`.
- G3 does not invent architecture outside its accepted contract.
- Before launch/transition/finality reconcile exact head, child/PR/parent, Lock/authority, checks, reviews/threads/findings and current programme state. Missing/stale/conflicting/unverifiable evidence => `PARENT_RECONCILIATION_INCOMPLETE`; missing is never green.
- A G4 blocker must identify the violated invariant and inspect materially equivalent in-Lock paths so G3 closes a defect family rather than examples.
- Same implementation lineage has a maximum of 2 corrections regardless of run/head/labels. After 2/2, return `NON_CONVERGENCE_DECISION_REQUIRED`; do not create Repair 3 aliases or reset by renaming.
- Exhausting repair budget ends only that implementation lineage, never an unresolved required task/blocker. If work remains required, hold and adjudicate; continue only through the smallest evidence-backed materially new authority boundary.
- External/provider/auth/transport/check/evidence-availability failures consume no repair budget unless they expose a candidate defect.

## Evidence and holds

- Later-required non-repository evidence must be deterministically reproducible from retained immutable inputs or durably retrievable by the intended consumer. Digest-only or temporary-path-only evidence is insufficient.
- A fresh rerun is not historical reconstruction. Before handoff prove evidence survives producer/session loss; on consumption verify bytes, digest, repo, Lock, candidate and run.
- Missing/expired/inaccessible evidence => `EVIDENCE_NOT_RETRIEVABLE` hold, not candidate repair consumption.
- Never widen secret/private retention or disclosure merely to improve convenience.
- Provider/check/auth/transport/evidence availability states are typed holds, not PASS or candidate defects.

## Parallel programme operation

- Parent owns programme topology/lifecycle; operational detail belongs to each child.
- Children use `QUEUED`, `CURRENT`, `COMPLETED`, `RETIRED`. `CURRENT` means live; multiple CURRENT children/lanes may exist only under current authority.
- At every material transition inventory all CURRENT lanes and advance every authorised non-conflicting lane. Never silently starve, demote or idle a live lane.
- If a lane cannot progress, record an explicit HOLD/dependency/order reason. Read-only G1/G2/G4 work may continue beside unrelated mutating work; concurrent G3 mutation requires disjoint scopes.
- Integration is serialized and must revalidate current base/main before consequential integration.
- `POST_SHIP` material decisions retain exactly one durable future owner without becoming current implementation scope.
- Durable lane state and authority-bearing terminal packets must survive unchanged until consumed. Summaries may accompany them but may never replace/compress the canonical packet.

## G4 vs Final Audit

These are different assurance layers and MUST NOT be conflated.

### G4

- Per-candidate / per-PR assurance.
- Fresh isolated, read-only, exact-head.
- Runs whenever the accepted gate flow requires independent candidate assurance.
- A candidate may require G4 even though substantial child/programme work remains.

### Final Audit

- One whole-child/programme completion audit, read-only, using Astra Max by default.
- It is admitted only after every required task/lane in the audit scope is terminal or explicitly resolved; required candidate G4s are complete; intended integrations/merges are complete and canonical state is read back; and no mandatory blocker, HOLD, non-convergence decision or unresolved owner decision remains.
- It is NEVER triggered merely because one PR is described as `final`, `last`, `ready`, or looks like the final PR.
- It never substitutes for G4, repairs, unfinished tasks, integration or reconciliation.
- Web explicitly launches/adjudicates Final Audit and retains terminal child/programme closure authority.

## Recovery and transitions

- Durable GitHub/repository authority outranks chat/Loop summaries when they conflict. Persist material receipts.
- G4 is read-only. Loop converges authorised work; Web retains judgement/finality.
- Pre-S3 `RETURN_TO_WEB` behaviour is transitional and must not be reproduced as routine Loop architecture.
- After a terminal packet, reconcile live state. If the next action is already authorised, issue/launch it in the same controller turn. Wait only for a real blocker or material User/Web decision.
- Historical prompts/comments are evidence, not automatically current authority.

## Finality

Candidate/PR finality requires exact authority/scope, required checks, required G4, mergeable non-draft state when merge is intended, no unresolved blocker/HOLD, complete review inventory and independent verification/readback.

Programme/child closure additionally requires completion of the Final Audit when that audit is part of the programme contract. Final Audit remains the last assurance step, not a per-PR super-G4.
