# Toolkit Gate Rules

The gate playbook: G0, G1 and G2 sessions, reviewers and the controllers that launch them read it before starting. The global rules hold the risk tiers, the safety floor and everything every session needs; this file holds the gate mechanics. Repository rules still win on conventions, and nothing here relaxes the safety floor.

## Gate order

- **G0 Discovery** runs for every new task, repository or environment; only LIGHT edits and fixes inside an already-discovered task skip it. Walk the real happy path, find out what the stack really is (an app built in Flutter, for example, breaks browser automation such as Playwright) and test assumptions before planning. It can be short when the ground is already known. It returns the G0 plan: findings, chosen approach, acceptance, risks, and what was tried and failed.
- **G1 Builder** starts in a fresh session, with the G0 plan passed in its brief as the handoff. G0 and G1 share the same strong lead route. One builder owns the whole approved outcome across corrections, checkpoints and fresh sessions; in-scope fixes need no new admission. G1 includes UAT.
- **Review** follows the tier: full G2 for RISKY, one independent review for NORMAL, the builder's own diff read for LIGHT. Only LIGHT edits and fixes inside an already-discovered task skip G0; only LIGHT edits skip G2.
- Gate names `G0`, `G1` and `G2` are fine where the reader needs them.

## Fresh contexts

Fresh executor contexts are mandatory between G0 and G1, for initial G2, for a required model, effort or harness switch, runtime or environment replacement, activated instruction or profile revision or executor replacement, and after genuine session loss or forced compaction at a safe boundary. Planned G1 segment completion alone checkpoints and continues in the same session. An ordinary commit, test, helper return, tool call, milestone or evidence upload never requires renewal. A checkpoint (work pushed, the PR or brief current) is not a terminal outcome: the executor continues its next dependency-ready authorised step. A failed checkpoint save is a recovery boundary, never an automatic successor launch: keep the source and evidence, hold dependent effects and repair recovery. When renewal is actually required, reconcile any existing successor or uncertain launch, verify custody, stop the old writer and launch exactly one successor; it continues the same approved assignment without another scope approval.

## Recoverable work

There are no handover packets. Keep the work recoverable at all times instead: push work in progress to the branch, keep the PR (or the brief, before a PR exists) current at milestones, and post progress and decisions where every harness can read them: the PR, plus the programme issue comments when GitHub governance is ENABLED, otherwise the evidence store. Never rely on chat or host memory: a Projects controller may mirror state in project memory, never only there. Any new controller or executor starts from these, with no handover step, loading the current state and changed instructions rather than the full history.

## Building

- **Design policy:** give stateful or effectful behaviour (application, runtime, resource, persistence, workflow) a cohesive owner object with explicit constructor dependencies and methods that enforce its invariants and effect order, composed through narrow interfaces. Pure transformations, data definitions, predicates and stateless adapters may stay functions. No mutable state in module globals and no classes that only forward. Refactors keep public behaviour, approvals, independent readback, concurrency controls and recovery semantics. Record the boundary and reason for a consequential exception, and have planning, validation and every review check the actual state and effect owners and their dependency contracts, not class counts. Never refactor generated or third-party code as canonical source; keep its licences and provenance.
- **Invariant models:** RISKY authority, custody, state-machine or host-config features start in G0 from a written model of who may do what in which state and a closure matrix (command x state x role, or config key x cited host limit). G1 implements it as table-driven tests and G2 reviews against it; a path missing from the matrix returns it to G0-level revision, not a one-line patch.
- **Deployment branches:** unless the repository has its own convention, a deployment or release-preparation branch for a named environment is `deployment/<environment>` (lowercase, e.g. `deployment/staging`); never `deploy/`, `release-deploy/`, bare `prod/` or `staging/`. A branch name grants no deployment, merge or live authority.
- **Shipping floor:** before shipping, complete the applicable minimum: core functionality and critical workflows; consequential correctness; authentication, authorisation and tenant isolation; security boundaries; data integrity, persistence, migration and destructive-operation safety; privacy and secrets; required validation and truthful readiness evidence; deployment, health and rollback prerequisites when release is in scope; every explicit acceptance criterion. Classify remaining work as `SHIP_BLOCKER` or `POST_SHIP`. Known material defects in the floor block. Polish, speculative refactors, future-proofing, optional abstraction, non-critical cleanup and low-confidence risks are `POST_SHIP` unless concrete evidence makes them blockers.

## UAT

- G1 checks the actual user or operator surface for clarity during validation and UAT, and G2 treats unsafe or misleading text as a real finding.
- RISKY work gets agent UAT on the real installed hosts before any owner UAT; on a delta, rerun only the affected rows.
- Run the full qualification matrix once on the release candidate. On a delta, run the rows whose code changed plus one smoke row per mode.
- A new SHA alone does not invalidate UAT: supply impact evidence and record UAT_RETAINED, UAT_PARTIAL_REQUIRED or UAT_FULL_REQUIRED.

## G2 review

G2 starts after the working result and any owner UAT acceptance, in fresh independent contexts, and has no helpers. The pinned stack fixes the reviewer set (no added peer, duplicate or automatic closing panel), and every reviewer independently reviews the full accepted scope. Acceptance needs the whole roster, qualified routes, the exact candidate and coverage, verified evidence and no unresolved blocking finding, never a majority verdict or a scope/execution split. G2 stays adversarial on every reachable path inside the frozen supported host/environment matrix and agreed invariants. Reviewers block only on gaps that break an agreed criterion or the safety floor, or on an unexplained loosening (below); everything else is optional and never blocks. G2 scans every commit, title and body of a PR for personal data, and checks where a computation ran before accepting that data stayed in place. No review has a dollar cap.

- **No-weakening proof:** for changed detection or guard code, run base tests and fixtures on the head; each case blocked or flagged on base and now allowed needs a stated reason.
- **Early returns keep the guards:** every early return or fast path in changed code must still run the generic guards first (identity, path, secret, personal-data, approval), or show they are not needed, with a test.

## Fixes and delta reviews

- Before the first fix of a security finding, list every route to the same invariant and fix them together, with positive and negative controls. Two failed fixes of the same thing: stop and rethink.
- After a G2 PASS, a delta G2 runs when a new edit touches a RISKY path or changes behaviour the review relied on. Each delta G2 covers the whole diff since the last PASS, and rechecks target corrected boundary families rather than restarting discovery. Before merge to the default branch, any RISKY change no G2 has seen gets one. Tests and CI run on every edit.
- Correction rechecks use fresh contexts for the same selected reviewers unless a specific reviewer must be replaced. A same-family recheck is readmitted only on a closed family-closure record evaluated against the exact corrected candidate; a passing latest reproducer is not enough, and after two NOT PASSED rechecks of one family a consolidated root-cause reassessment comes first.
- Keep functional, UAT, review, custody, integration, publication, Core and parent states distinct.

## Routes

- Gate models and effort come only from an explicitly selected stack registry revision pinned in the controller decision and admission, never inferred from the host, provider, alias or newest bundled registry; a newer registry needs explicit adoption and never changes an active run. Keep qualification overrides separate from production selection, and each stack's lead and helper bindings independent.
- Model and effort follow launch ownership: a human's own choice for an agent they open directly (including a G2 chat) is advisory, not a blocker, and is recorded as the actual route, never labelled the recommended one; a model or effort difference alone is not a G2 failure. Every automation-launched G0/G1/G2 worker or successor, even as root of its own session, and every G0/G1 helper gets the exact pinned route for its role and member, with no fallback or weaker effort. A root label is not a human override, and no model lock goes into a human-run entrypoint. Native permissions, independence, reviewer obligations and delegation limits still apply.
- **Route proof:** pin model and effort in the launch command or config for every gate session. Where the host records the route it ran (the Claude init event or session metadata, a Codex run record), read that record once before consequential work and stop with a report when either is inherited, missing or different. Never ask the model which model it is: models misname themselves, so a self-report proves nothing. Where the host keeps no record, record "not checkable on this host" and carry on.
- Keep model, effort, tier and route out of portable task prompts unless a runtime requires them. Run parallel builders only on disjoint files with no dependency on work still in review.
