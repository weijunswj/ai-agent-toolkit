# Closure-Lease Protocol

## Prompt contract

A web-issued execution prompt must resolve every field at runtime. A template is invalid when it supplies a route, authority, readiness, completion, or capability default.

Required fields:

- Provider: {{provider}}
- Canonical base model: {{canonical_base_model}}
- Reasoning or effort: {{reasoning_or_effort}}
- Reference-family reasoning equivalent: {{reference_family_reasoning_equivalent}}
- Sol-equivalent reasoning: {{sol_equivalent_reasoning}}
- Harness/adapter: {{harness_adapter}}
- Surface: {{surface}}
- Role: {{role}}
- Exact repository: {{repository}}
- Exact scope: {{scope}}
- Exact authority: {{authority}}
- Fast mode: prohibited
- Route substitution: prohibited

The prompt carries the exact Design Lock, branch, PR, merge base, base commit, admitted head, tree, parent entry, review state, requested-reviewer state, and live body hashes. Omitted, generic, conflicting, or stale values fail admission.

## Admission and activation

Web first reconciles the raw child body, PR body, exactly one parent entry without unrelated reordering, and one parent chronology comment. It then verifies exact authority and issues one explicit grant for one exact scope. Missing activation returns CLOSURE_LEASE_NOT_ACTIVATED.

Design merge, toolkit installation, closure-lease activation, and pilot activation are separate grants. A prompt, memory, Custom Instructions, project memory, queue position, eligibility, issue wording, completion, or merge cannot substitute for a grant. The ordinary worker cannot issue or renew a grant.

The active root claim is an atomic record bound to the exact repository, PR, branch, base, head, tree, merge base, Design Lock, role, and run. A second claim for the same exact scope or a claim for a different scope is rejected. Expiry stops activity; it never transfers ownership. Replacement requires trusted revocation or terminal proof and a new exact grant.

## Capability parity and isolation

The adapter proves every required capability before admission: exact authority, fresh isolation, bounded mutation, review/evidence behavior, failure semantics, and truthful cleanup. Unsupported capability returns UNSUPPORTED_DELEGATION without route substitution or reduced evidence.

The worker uses a fresh isolated workspace at the admitted head. It may modify only the exact repository-file allowlist, preserve source-only output boundaries, and make ordinary non-force commits on the existing branch. It cannot write hosted governance, comments, reviews, issue state, ready state, merge state, installation, pilot, scheduler, Auto Review, or Ledger state. Cross-repository fan-out and cross-PR mutation are prohibited.

## Reconciliation transaction

Every material transition repeats raw reconciliation. Compare-and-preserve updates retain unrelated parent content and order. Any missing, duplicate, stale, conflicting, partial, or concurrent movement returns PARENT_RECONCILIATION_INCOMPLETE. No worker prompt, readiness, acceptance, merge, closure, next-task selection, or completion proceeds while that result is present.

Fixture projections, fallback bodies, declared readiness, declared completion, memory, and pasted conclusions are context only. The runner derives decisions from raw evidence and filesystem discovery. Authority-bearing fixture defaults, projectionDefaults, hidden fallback bodies, and self-attested route capability are invalid.

## A4 exact-head review and assurance contract

Before an external review is requested or consumed, bind its identity to repository + PR + exact head SHA + external-review capability. Raw evidence must prove the exact binding, capability, and one unambiguous pending or completed state. An unusable, stale, unbound, or ambiguous review does not satisfy the gate. On an unchanged identity, a usable pending review suppresses a duplicate trigger; a usable completed review is consumed and its findings are adjudicated without retriggering. Review or model limit exhaustion returns REVIEW_LIMIT_EXHAUSTED, never PASS. A changed head creates a new identity and requires a new usable external review and a newly isolated G4.

A technical G4 reviewer runs in a newly isolated context and is the sole source of PASS or AMEND for one exact head. It never implements repository changes. During every AMEND cycle it sends one complete finding batch to the closure manager and must not reply to or resolve review threads. Only after technical PASS on the final exact head may it send a bounded, evidence-backed technical reply; all threads remain unresolved. It never marks ready, accepts, merges, closes, deletes a branch, installs, activates a pilot, or selects another task. A changed head invalidates the prior verdict and requires a fresh G4. Findings remain binding. The closure manager cannot suppress, overrule, reinterpret, or self-accept.

After final exact-head G4 PASS and before assurance, web independently rereads and verifies the exact repository, branch, base, head, tree, complete commit graph, cumulative diff, file allowlist, source-only boundary, local validation, hosted checks, all review submissions and threads, every finding-to-code/test/evidence mapping, and the absence of unexpected authority or governance movement. Until this verification is recorded, assurance must not run and the result is WEB_VERIFICATION_REQUIRED.

The independent assurance context returns exactly CLEAR or CONCERN. It is non-authoritative and cannot return PASS or AMEND, authorise merge, mutate hosted repository state or select another task. CLEAR allows web finality only; it does not authorise merge. On CONCERN, web must independently reply to and resolve every thread proven addressed, duplicate, stale, or not applicable, leaves concern-related, newly actionable, or insufficiently proven findings open, and sends only that remaining set back to the review loop. Previously resolved threads stay resolved unless a later amendment regresses the relevant behavior or contrary evidence is supplied; only web may reopen them.

Ordinary findings and a provably terminated non-mutating worker stay inside the closure loop. Return to web is allowed only for INTERRUPTED_SESSION_OWNERSHIP, EXACT_AUTHORITY_MOVEMENT, scope or Design Lock conflict, REVIEW_LIMIT_EXHAUSTED, NON_CONVERGENCE, secret exposure or required rotation, or a genuine user/controller decision.

## Reviews, G4, and assurance

The final pre-G4 reviewer reports observations only. A technical G4 reviewer runs in a newly isolated context and is the sole source of PASS or AMEND for one exact head. A changed head invalidates the prior verdict and requires a fresh G4. Findings remain binding. The closure manager cannot suppress, overrule, reinterpret, or self-accept.

Conflicting, impossible, scope-expanding, or authority-expanding findings return to web. After G4 PASS and ordinary web adjudication, the independent assurance auditor returns CLEAR or CONCERN only. Assurance is not G4 and cannot authorise merge; CONCERN blocks acceptance pending web adjudication.

## Evaluation and cleanup

The evaluation-staging lane emits at most one public-safe candidate payload for the exact source revision. It contains no score, evaluation verdict, hidden reasoning, secret, environment value, private task/session identifier, managed-session identifier, or adapter-internal identifier. The worker does not write Ledger issues or claim a Ledger receipt.

Cleanup evidence must prove the module remains source-only, uninstalled, unscheduled, inactive, without a root claim, managed loop, automatic pickup, generated consumer surface, or orphan process. Completion and merge never activate or select a next task. A final report is evidence for web, not a G4 verdict.

## A6 target topology and assignment resolution

The three-surface lifecycle begins only after separate source acceptance, design merge, toolkit installation, and explicit activation grants. A source change, merge, installation, or activation never implies another grant. Until all required grants are explicit, the module remains source-only and no A6 surface dispatch occurs.

The Web Orchestrator is the sole persistent controller surface and exactly one exists per governed task or PR. It owns architecture, Design Locks, assignment resolution, dispatch, hosted governance, review disposition, exact-head acceptance, assurance eligibility, ready state, merge, closure, installation, activation, and next-task selection. The Executor-root and Temporary Chat never acquire those powers.

After adoption and activation, exactly one persistent Executor-root coordinates prompt-bounded implementation, amendment, pre-G4, and G4 runs. Every subordinate run starts fresh with a newly resolved assignment and an independently clean exact-authority worktree. The root only collects and reconciles evidence packets; persistence is not implementation or governance authority. A retained, dirty, inherited, or ambiguous workspace returns SURFACE_TOPOLOGY_INVALID.

A fresh Web Temporary Chat is eligible only after final exact-head technical PASS and independent Web verification. It is read-only and returns exactly CLEAR or CONCERN. It cannot return PASS or AMEND, mutate hosted governance, authorise merge, or select work.

## A6 model-assignment resolution

For every dispatch, resolve one complete assignment from one source. The latest applicable complete explicit user assignment in the current persistent Web Orchestrator chat wins. Only when no applicable current-chat assignment exists may the Web Orchestrator fall back to the complete, unambiguous current canonical Custom Instructions repository, file, ref or commit, and blob. A current-chat assignment that is present but partial, conflicting, or ambiguous returns MODEL_ASSIGNMENT_REQUIRED; it must not fall through. Current-chat and Custom Instructions values are never combined.

The rendered prompt records assignment source and assignment evidence locator. Provider, canonical base model, reasoning, Sol-equivalent reasoning, role, surface, repository, and exact authority remain explicit runtime values. Memory, preference, cost, capability, benchmarks, issue wording, prior runs or chats, and availability cannot select or suggest a model. An unselected alternative returns MODEL_ASSIGNMENT_REQUIRED. No dispatch occurs until the source and evidence are complete and bound.

A6-C2 is a narrow source-only implementation exception for this continuing G3 chat and retained worktree. It is not activation, not a persistent Executor-root, and not a future runtime workspace-reuse rule.
