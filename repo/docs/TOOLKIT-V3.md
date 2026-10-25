# Toolkit V3: delivery contract

This is the current V3 delivery contract for the Toolkit programme. It states the law that applies now; the dated decisions, launch reconciliation and one-off evaluations that produced it are in git history (section 20). The [global rules](../contracts/agent-rules/global-rules.md) hold the risk tiers and the safety floor, the [gate rules](../contracts/agent-rules/gate-rules.md) hold gate mechanics, and [CONTROLLER.md](../CONTROLLER.md) holds controller duties. Publishing this document does not establish implementation, installation, UAT, review or programme completion.

## 1. The product and the finish line

Toolkit is a portable delivery framework. A user gives a controller an outcome; executors discover the real environment, agree the scope, build a usable version, obtain acceptance, get it reviewed and finish the authorised delivery. Source, decisions, evidence and the next action survive any change of chat, model, harness, environment or controller.

The normal coding workflow is **G0 Discuss/Discovery → G1 Builder, including UAT → G2 Review**. It is the default Shipping Law unless the user specifies another workflow. Every new task, repository or environment starts with G0; only LIGHT edits and fixes inside an already-discovered task skip it. Otherwise the risk tier of the changed paths (RISKY, NORMAL or LIGHT, from the risk-tier script in the global rules) sets only the depth of UAT and review. Routine, already-authorised work proceeds without repeated permission questions. Track builder readiness, UAT, review, custody, integration, installation, Core release and parent completion separately.

| Completion | Required result |
|---|---|
| A milestone | Its agreed observable outcome, with evidence. A checkpoint is not completion. |
| A Core release | The approved Core works in the agreed environment, is accepted, passes the review its tier requires, and is integrated and installed with custody and recovery working. |
| The programme parent | Every committed Now, Next and Later obligation is done or disposed of by the user. |

Neither record neatness nor an optional idea is a hidden prerequisite for shipping, and no paper contract, synthetic replay or green CI substitutes for the usable result.

## 2. Authority and adoption

This contract replaces conflicting user-owned Toolkit process requirements for this programme, preserving higher-priority instructions, native permissions, secret handling and controls on consequential effects. A repository document never manufactures an owner approval a host recognises. Other repositories keep their own bindings. Old gate names describe historical work; never relabel an old review as the final G2, reset exhausted unsafe operations or erase a denial.

## 3. Now, Next and Later

Every open outcome is committed or optional, with one stable child issue per coherent outcome. Do not create container issues for the groups. Where an outcome sits is worked out from its release, never set by hand:

| Group | Meaning | Admission |
|---|---|---|
| NOW | In progress: an open release PR or an active gate, including work merged but still waiting on its UAT or review. The complete usable release currently approved, with its necessary security, privacy, integrity and recovery floor. | The user agrees the outcome; routine means are delegated. |
| NEXT | Queued for a named planned release. By convention a release has a name, not a version number; the version is taken when it merges. | The user agrees the release plan. |
| LATER | Committed, with no release yet. | New material capabilities need user agreement first. |

Optional work the user keeps sorts after Later as OPTIONAL. Committed Later work is not optional: anything uncommitted is closed with its reason or kept as optional by the user. Ship the Now release with its safety floor, then the Next release; real defects come first by impact. When a release closes, G0 proposes the next one from Next and related Later work and the same open children are updated. A clarification may join the current release; a material addition is proposed with its effect on the finish line.

## 4. Where the plan and milestones live

The programme parent is the current index: the Core outcome, children, milestone order, acceptance, position, decisions and the sorted catalogue. Each child holds its acceptance, checklist, evidence, checkpoint, blockers and next action. Roles, milestones, commits and sessions create no issues; the default milestone is one coherent outcome child. After a material change, regenerate the parent in Now, Next, Later order, preserving concurrent edits or reporting a precise conflict.

The programme reconciler owns state, hierarchy, projections and CURRENT. Its acceptance: native relations match canonical state; dependencies never reparent; reclassification keeps identity and scope; graph and roadmap share one revision; child and PR data agree; stale projections are detected; history stays accurate; and G1 continuation creates no gate, duplicate child or false finality.

## 5. G0 Discuss, Discovery and planning

**G0.Discuss: mandatory consideration, conditional discussion.** Before discovery, the same G0 main agent considers the proposed goal and approach. If it identifies a material alternative, disagreement or question that needs resolution, it returns it to the accountable controller for discussion and agreement before proceeding with the affected work. If it agrees and the scope is clear, it proceeds directly with discovery without a forced extra turn. Routine technical decisions remain with the strong lead. It must not choose an unresolved direction autonomously or manufacture a debate. This is a step within G0, using the same main agent and exact stack-selected model/effort binding as G0.Discovery; it creates no separate gate, standing peer agent or additional model route.

After discovery, G0 records the evidence and recommended direction in the current release brief. Resolve material deviations from the agreed goal or approach before G1, through discussion and agreement within existing authority. When the direction remains within approved scope and current authority, continue already-authorised G1 without renewed semantic approval. Preserve the actual G0-to-G1 role/context handoff. Genuine owner boundaries, including material scope, trust, security, risk, spend, consent or acceptance changes, remain owner decisions.

G0 is a strong reasoning lead. It walks the real happy path and checks the actual stack, environments, installed instructions, dependencies, credentials **by reference** and existing work; a repository-only guess is not enough when the outcome depends on a deployed app or native harness. The release brief holds the outcome, commitments, milestones, host matrix, acceptance and UAT path, risk tier, unknowns, evidence store, authorised effects, selected stack and next builder action. G0 asks the user only about an unresolved material choice, missing access or a scope change.

**Frozen supported profile.** Before final review, that existing release brief binds, for each approved host: supported OS, runtime, provider, model and effort; executable and install locations and their protection assumptions; native trust, hook and plugin loading; authoritative entrypoints and alternate invocation paths; credential references; data and effect targets; principals and permissions; threat boundaries; acceptance criteria; available positive and negative evidence; explicitly unsupported states; and rollback. This is part of existing G0/G1 work, not a new gate. Actual source, UAT and installed state must match it. It records the approved host matrix as approved; only the owner can reduce supported hosts.

## 6. G1 Builder, integration and UAT

G1 receives the whole approved scope, builds and integrates it, runs meaningful tests, demonstrates it and resolves ordinary UAT feedback and defects without another admission. The user owns the outcome, material scope and acceptance; the builder owns the plan within them and never silently changes scope, trust boundaries, paid services, destructive effects or acceptance. Design follows the gate rules' building policy, every change follows the global change-local hygiene law, and work finishes before stopping as the global Shipping section says.

G1 reaches the actual consumer boundary: mocks never prove an installation or operation they did not exercise, and it reports what ran, failed and was not exercised. UAT depth follows the tier and the gate rules' UAT section: RISKY work gets agent UAT plus owner UAT for any final-product steps; otherwise owner UAT runs when the user's surface changes. User acceptance covers only the final product: features a Toolkit user runs and sees, such as hook setup in Codex or Claude Code, a quote run or a design run. Internals (governance, programme state, gate plumbing) and everything CI (Windows runners included), automated tests, G2 review and agent UAT prove are accepted objectively and listed beside the owner steps with the passing check that covers it; when no final-product step changed, UAT is recorded as not required. Silence is not approval.

## 7. Context and fresh sessions

There is no handover packet: state lives in the pushed branch, the PR or brief, the programme comments and the evidence store, so a controller or executor can be switched at any time (section 16). G0.Discuss and G0.Discovery may reuse the same G0 session because discussion depends on the goal and discovery findings. This does not remove the fresh-context boundary between G0 and G1 or any independent final-review requirement. Fresh executor contexts are mandatory between G0 and G1, for initial G2 and at the other renewal boundaries in the gate rules, which also hold checkpoints and successor launch.

## 8. G2 Review and finding disposition

G2 starts after G1's working version and any required user UAT are accepted. Review depth follows the risk tier: RISKY work gets the full G2, NORMAL one independent review and LIGHT the builder's diff read. G2 uses fresh independent reviewer contexts, the actual candidate, the complete approved scope and its evidence. G2 does not spawn subagents. Every assigned reviewer independently reviews the complete approved scope and implementation, with execution, evidence, installation, authority, security, privacy and recovery; reviewers never split scope from execution. The selected stack fixes the set (section 10), and the gate rules hold launch ownership, delta reviews and rechecks.

| Disposition | Required explanation and action |
|---|---|
| Current ship blocker | The criterion or safety invariant broken, the concrete failure or absent proof, and the smallest fix. |
| Follow-up | The added protection and why acceptance still holds; kept out of the current release. It joins an existing or new outcome child (section 4), whose planned release or lack of one makes it Next or Later. |
| Later or optional | The new outcome and its queue; never silently added to the Core. |
| Unsupported or duplicate | The evidence problem or the existing finding. |

**Bounded adversarial security review.** G2 reviews against the section 5 frozen supported profile and the agreed invariants, and stays adversarial on every reachable path inside it. A security finding blocks Core when a plausible supported-path trace violates an existing acceptance or safety invariant, or proves critical required evidence absent; record the concrete setup, attacker capability, reproduction or trace, consequence and minimum correction. An unsupported arbitrary layout or extra execution surface does not by itself create Core scope, and a newly proposed environment, feature or threat goes to the owner for classification before adoption. A genuinely serious reachable issue found late still blocks, even when an earlier review missed it. When a finding demonstrates a family of related reachable bypasses, G1 inventories every material entrypoint for that invariant inside the frozen profile and fixes the family once, with positive and negative controls, rather than one bypass per cycle. The fresh recheck covers the corrected families, cumulative diff, dependent invariants, new real host evidence and retained previously reviewed scope. It does not restart discovery, rescan the whole product by default, add reviewers or open unbounded follow-up work, and it preserves any genuinely new security finding without manufacturing an extra gate.

## 9. Consequential boundaries

Live permission-controlling instructions, destructive migration, privileged production changes and irreversible publication need authority, exact scope, recovery and a narrow pre-effect check before their real effects. Build and test candidates in isolation with host controls intact, activate only the reviewed candidate and read back installed files, hooks, versions and entry points. A design challenge is exceptional, never a routine fourth role. Merge, installation and activation authority are recorded separately; one never implies another.

## 10. Model and subagent bindings

The central named stack registry is the sole source of model and effort choices. Every consumer resolves an explicitly selected stack and role against its pinned registry revision, with no competing choice, default or silent fallback, and a new revision is adopted deliberately. When selection is missing, the controller asks once **and holds dependent execution**, and launch admission enforces the hold without the hook. Launch ownership and route proof are in the gate rules.

| Selected stack | G0 and G1 lead | G0 and G1 helpers | Design challenge | Final G2 set |
|---|---|---|---|---|
| `owner-gpt` | Sol 6.1 High | Luna Max | Sol 6.1 XHigh | One Sol 6.1 XHigh review |
| `owner-claude` | Opus 5.5 High | Haiku 5.5 XHigh | Opus 5.5 XHigh | One Opus 5.5 XHigh review |

This table projects the registry. G0.Discuss resolves to the same selected lead binding as G0.Discovery, with no separate registry role or hardcoded provider/model. Helpers are leaves: no recursive delegation, scope approval, gate dispatch or final acceptance. An absent exact route is reported, never substituted.

## 11. Controller and executor responsibilities

The controller owns the user relationship, material scope decisions, release order, assignment, review routing, conflicting authority and writers, finding disputes and confirming completion. The executor owns investigation, implementation, leaf delegation, tests, UAT-ready delivery, ordinary corrections, publishing its own progress and evidence, and keeping the PR or brief current. Do not route mechanical edits or uploads through the controller.

## 12. Approval provenance and diagnosis

Before editing policy, find the layer that denied an operation: instructions, hooks, launch settings, host approval policy, connector scope, sandbox, network or delegation. Standing authority names owner, destination, purpose, operations, data boundaries and cleanup, and reaches the host through its supported mechanism, never through an emphatic assistant-written claim. When a platform needs a direct owner action, explain it once, keep the operation pending and do independent work; never weaken native controls or switch routes to evade a denial.

## 13. Private evidence and cleanup

Work in the assigned environment, secret-scan and upload the needed evidence to the **already-selected private store**, read it back, delete eligible scratch once its report and kept evidence are stored and read back, and keep the PR, brief or programme comment current. When no store has been selected, discuss the choice once and recommend a private `TRANSPORT-*` Git repository by default. The user's selection of another supported private backend takes precedence over that recommendation, and a capability that backend lacks is a backend-specific HOLD, not a reason to switch.

In a Git store the commit is the manifest, and a successful push plus one fetch is the read-back. Archive once, at gate end; keep run streams only for a FAIL or a disputed verdict. There is no expiry clock, pin or cleanup ledger. If transfer fails, report custody pending and keep the local material. Never delete the only copy, user data, active or UAT resources or unresolved evidence. Git cleanup is an ordinary non-force commit and never removes history; another backend uses its own supported capability or holds the cleanup.

## 14. Installation and supported surfaces

Native plugins target Codex (`owner-gpt` routes) and Claude Code (`owner-claude` routes); Antigravity gets a portable skills copy only. Before inference by an automation-launched agent or helper, deterministically enforce the requested-helper permission, the selected profile and pinned revision, the effective provider, model and effort, and native inheritance and overrides; leaves and G2 cannot delegate. These checks never lock a human's manually selected first-layer model or effort (section 10). Use the host's blocking parent PreToolUse path; a child hook or SubagentStart alone is insufficient.

Per host path, qualify the correct route and each wrong-route, guard-failure, missing-hook, malformed-config, post-check-change, resume, alternate-entry and delegation negative; a request that escapes the guard fails even when something downstream stops it. Installed proof checks effective instructions, hooks, route and caches, and a new session must receive the current instructions.

A fail-open host requires an enforceable launcher or a disabled uncontrolled helper path. An unenforceable exact helper path is UNQUALIFIED and cannot be used uncontrolled; direct strong-lead work is the allowed exception. Host PASS requires correct-route execution, wrong-route prevention and failure-resilience proof; documentation, a copied plugin or unit tests alone do not qualify a host. Remove stale Toolkit-owned plugin, cache or staging copies only after the new active version is proved.

## 15. Security and operational commitments

Every Core includes the security, privacy, integrity and recovery its effects need, checked locally with evidence-backed findings. Security scanning, secret references, external-operation authority, backup and restore, deployment and rollback, and host-service capabilities remain programme outcomes in the parent catalogue.

## 16. Switching controllers and executors

Switching needs no handover step. A new controller binds current main and its CONTROLLER.md blob, posts its one-line takeover record and reads the durable state; a new executor starts from the same state. Reconcile uncertain effects and active writers first.

## 17. Canonical implementation surfaces

The controller procedure and repo map, the agent rules, the stack registry and resolver, the control plane and reconciler, setup and hooks, and tests with generated payloads each own their part, as the repo map lists. Never hand-edit a generated block; edit its source and run its sync.

## 18. V3 Core acceptance matrix

The release brief binds each row to exact sources, environments and evidence.

| Criterion | Demonstration required |
|---|---|
| Complete scoped outcome | One usable V3 workflow with its approved host coverage, from real discovery of the actual stack. |
| G0 consideration and discussion | Section 5's discussion and continuation rules hold in a real run: a material question returns to the controller, a clear scope proceeds without an extra turn, and approved direction continues into a fresh G1. |
| Strong roles | Pinned launcher routes from the selected stack, leaf helpers, G2 with no subagents, no silent fallback, and a missing selection that asks once and holds dependent launch. |
| Continuous delivery | Planned G1 segment completion alone checkpoints and continues the approved whole-phase Core in the same session; actual required renewal and fresh independent review remain binding, and a genuine HOLD blocks only its dependent steps. |
| Portable recovery and programme truth | A fresh consumer recovers source, state, evidence and next action from durable state alone; the parent stays sorted and section 4's cases pass with real readback. |
| Standing authority and custody | Routine writes run without repeated approval; upload, read-back and cleanup protect the only copy, active and UAT resources, tested on disposable fixtures for drift, races, interrupted deletion and a producer crash. |
| Source and installed authority | The isolated, reviewed candidate is promoted deliberately, and a fresh session shows matching instructions, hooks and version. |
| Independent assurance | Every member of the selected set reviews the complete scope with exact candidate and route identity. Missing, duplicate, stale or wrong-route automated returns cannot complete the set; an owner's manually selected reviewer model and effort are recorded as actual and are not wrong-route solely for differing from the stack. |
| Security review boundary | The release brief freezes the supported profile for each approved host before final review, and G2 is adversarial on every reachable path within it. Ship status keeps source-green, owner UAT, the native qualified host matrix, merge/install/activation authority and installed proof separate. A genuine host-unavailable HOLD is neither product-red nor success; only the owner may choose a reduced supported release, with residual hosts tracked. |

Test the actual supported controller/launcher continuation path when section 7 requires renewal, with a harmless segment and consumer readback:

| Case | Required observation and expected result |
|---|---|
| 1. Required renewal at a completed segment | An actual section 7 renewal trigger, verified checkpoint, stopped old writer, satisfied dependencies and an already-authorised next segment cause exactly one successor, with no owner prompt. |
| 2. Successor already active or launch ambiguous | Reuse the matching successor; reconcile ambiguity before any retry. |
| 3. Lost controller session | Recover durable state and resume without replaying effects. |
| 4. Valid failing checkpoint | Renew only when section 7 requires it, into authorised repair/validation when safe. |
| 5. Genuine permission hold | No dependent effect until permitted; independent work continues. |

## 19. Running a delivery

1. Read the brief, this contract and the parent plan; resolve only changed evidence.
2. Establish a single writer, run G0 against the actual environment and name the risk tier.
3. Launch one G1 for the complete scope through a launcher that enforces the exact pinned-stack route for the role, not a prompt that merely names it.
4. Get the UAT and review the tier requires, return genuine blockers as one correction, then complete the authorised merge, activation and installed proof.

## 20. History

The dated owner decisions, launch reconciliation, the bounded evidence-integrity evaluation and the earlier retention clocks behind this contract are in git history at commit `1a64367`, with a copy in the Toolkit evidence store. History is evidence, never a competing current instruction.
