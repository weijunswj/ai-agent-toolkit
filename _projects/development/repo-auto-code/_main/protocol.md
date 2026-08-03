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

## Model-neutral G4 and Web Temporary Chat contract

`technical G4 reviewer` is the structural term for the technical-review function. G4 is not a model name. The reviewer resolves its provider, canonical base model, and reasoning independently from the one controlling assignment source for that dispatch. A directly assigned G4 provider or model may differ from the Web controller. Historical model identities in retained evidence remain truthful historical values. Model, role, reasoning, and surface identity never grant authority.

After every final exact-head technical `PASS`, Web must complete independent exact-head verification and then create exactly one fresh Web Temporary Chat for that exact head. The Temporary Chat is separate from the Executor-root, implementation/amendment runs, and G4 run. It independently assesses bounded exact-head evidence, does not treat a G4 packet or self-attestation as proof, records both the G4 execution identity and its own Web execution identity, and records cross-provider/model diversity when present. It remains mandatory when both executions use the same model family. It may return `CONCERN` despite G4 `PASS`.

The Temporary Chat returns only `CLEAR` or `CONCERN`. It is not G5, does not replace G4, and has no GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority. G4 `PASS` is necessary but insufficient for `CLEAR`.

## Cumulative semantic invariant registry

The following JSON block is the machine-readable cumulative source contract. Every record must retain all seven fields. `required_semantics` and `candidate_evidence` are complete semantic bundles, not keyword lists. A missing field, missing bundle member, weakened description, keyword-only substitute, or negative-test mismatch returns `INVARIANT_REGRESSION`.

```json
{
  "schema": "cumulative-invariant/v1",
  "invariants": [
    {
      "invariant_id": "AUTH-LEDGER-RECEIPT-001",
      "source_authority": "A1-A6 accepted ledger safety requirements",
      "required_semantics": [
        {"semantic_id": "matching_marker_and_run", "requirement": "The receipt marker and run identifier match the authorised operation."},
        {"semantic_id": "processor_authored_receipt", "requirement": "The processor that performed the operation authors the receipt."},
        {"semantic_id": "canonical_durable_readback", "requirement": "The receipt is read back from the canonical durable ledger surface."}
      ],
      "candidate_evidence": [
        {"semantic_id": "matching_marker_and_run", "evidence_fields": ["marker", "run_id", "authorised_operation"]},
        {"semantic_id": "processor_authored_receipt", "evidence_fields": ["processor_id", "receipt_author"]},
        {"semantic_id": "canonical_durable_readback", "evidence_fields": ["canonical_ledger_ref", "durable_readback", "readback_digest"]}
      ],
      "negative_test": "C4 rejects an AUTH-LEDGER-RECEIPT-001 candidate with any receipt semantic omitted",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "SCHEMA-EVAL-CANDIDATE-001",
      "source_authority": "A1-A6 evaluation-candidate contract",
      "required_semantics": [
        {"semantic_id": "candidate_identity_and_result", "requirement": "The candidate records run_id, provider, base model, role, revision, result, and evidence."}
      ],
      "candidate_evidence": [
        {"semantic_id": "candidate_identity_and_result", "evidence_fields": ["run_id", "provider", "base_model", "role", "revision", "result", "evidence"]}
      ],
      "negative_test": "C4 rejects a SCHEMA-EVAL-CANDIDATE-001 candidate missing any required evaluation field",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "SCOPE-GOV-TRACKING-001",
      "source_authority": "A1-A6 repository scope and governance tracking contract",
      "required_semantics": [
        {"semantic_id": "authorised_repository", "requirement": "The repository is owned or explicitly authorised for the operation."},
        {"semantic_id": "relevant_task_work", "requirement": "Relevant task work exists and is bound to the governed repository."}
      ],
      "candidate_evidence": [
        {"semantic_id": "authorised_repository", "evidence_fields": ["repository", "ownership_or_authorisation", "authorisation_evidence"]},
        {"semantic_id": "relevant_task_work", "evidence_fields": ["task_id", "relevant_work", "scope_binding"]}
      ],
      "negative_test": "C4 rejects SCOPE-GOV-TRACKING-001 when ownership or relevant task work is absent",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "CONCURRENCY-GOV-WRITE-001",
      "source_authority": "A1-A6 compare-and-preserve governance write contract",
      "required_semantics": [
        {"semantic_id": "reread_and_bind", "requirement": "The actor rereads the current surface and binds its revision before preparing a write."},
        {"semantic_id": "compare_and_preserve", "requirement": "The actor compares the bound revision and preserves unrelated content and order."},
        {"semantic_id": "write_and_reread", "requirement": "The actor writes only after comparison and rereads the result to verify the bound update."}
      ],
      "candidate_evidence": [
        {"semantic_id": "reread_and_bind", "evidence_fields": ["reread_revision", "bound_revision"]},
        {"semantic_id": "compare_and_preserve", "evidence_fields": ["comparison_digest", "unrelated_content_preserved", "order_preserved"]},
        {"semantic_id": "write_and_reread", "evidence_fields": ["write_digest", "post_write_readback", "readback_revision"]}
      ],
      "negative_test": "C4 rejects CONCURRENCY-GOV-WRITE-001 when reread, compare, preservation, write, or readback is missing",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "REVIEW-STATE-RECONCILIATION-001",
      "source_authority": "A4 exact-head review completion and parent governance contract",
      "required_semantics": [
        {"semantic_id": "four_surface_reconciliation", "requirement": "Exact-head external-review completion is reconciled across the child body, PR body, exactly one parent entry, and one new parent chronology comment."},
        {"semantic_id": "stale_state_blocks_progression", "requirement": "Missing or stale review state blocks the next prompt, technical G4, and finality."}
      ],
      "candidate_evidence": [
        {"semantic_id": "four_surface_reconciliation", "evidence_fields": ["child_body", "pr_body", "parent_entry_count", "parent_chronology_comment"]},
        {"semantic_id": "stale_state_blocks_progression", "evidence_fields": ["review_state_fresh", "next_prompt_allowed", "g4_allowed", "finality_allowed"]}
      ],
      "negative_test": "C4 rejects REVIEW-STATE-RECONCILIATION-001 when any governance surface is absent or stale",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "G4-WEB-ASSURANCE-001",
      "source_authority": "A6-C3 model-neutral technical G4 and fresh Web assurance contract",
      "required_semantics": [
        {"semantic_id": "technical_function_and_independent_assignment", "requirement": "G4 is a technical-review function with an independently resolved provider, canonical model, and reasoning."},
        {"semantic_id": "fresh_assurance_after_verification", "requirement": "Exactly one fresh Temporary Chat follows final exact-head PASS and independent Web verification."},
        {"semantic_id": "bounded_non_authority", "requirement": "The Temporary Chat independently checks evidence, records both execution identities, returns only CLEAR or CONCERN, and has no finality or GitHub authority."}
      ],
      "candidate_evidence": [
        {"semantic_id": "technical_function_and_independent_assignment", "evidence_fields": ["g4_role", "g4_provider", "g4_canonical_model", "g4_reasoning", "assignment_source"]},
        {"semantic_id": "fresh_assurance_after_verification", "evidence_fields": ["g4_verdict", "final_exact_head", "web_verified", "fresh_temporary_chat_count"]},
        {"semantic_id": "bounded_non_authority", "evidence_fields": ["g4_execution_identity", "web_execution_identity", "independent_evidence", "verdict", "merge_authority"]}
      ],
      "negative_test": "C4 rejects G4-WEB-ASSURANCE-001 when assurance is missing, duplicated, dependent, or authority-bearing",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "EXECUTION-ADMISSION-DEFAULT-DENY-001",
      "source_authority": "A6-C5 default-deny execution admission contract",
      "required_semantics": [
        {"semantic_id": "default_deny", "requirement": "Fast and Agent or spawn_agent delegation are denied without an exact current-turn grant."},
        {"semantic_id": "bound_non_replayable_grant", "requirement": "A grant binds run, session, turn, operation, model, reasoning, count, expiry, consumption, and non-inheritance."},
        {"semantic_id": "prelaunch_fail_closed", "requirement": "Supported ordinary spawning requires a trusted PreToolUse hook; missing or unverified coverage falls back to root-only Standard mode and SubagentStart is audit-only."}
      ],
      "candidate_evidence": [
        {"semantic_id": "default_deny", "evidence_fields": ["allow_fast", "allow_agents", "grant_present", "default_decision", "explicit_current_turn_user_request"]},
        {"semantic_id": "bound_non_replayable_grant", "evidence_fields": ["issuer", "explicit_current_turn_user_request", "run_id", "session_id", "turn_id", "operation", "provider", "canonical_model", "reasoning", "max_agents", "expires_at", "consumed", "inheritance"]},
        {"semantic_id": "prelaunch_fail_closed", "evidence_fields": ["hook_installed", "hook_event", "hook_identity", "hook_bytes", "hook_version", "hook_trust", "runtime_coverage", "subagent_start_audit_only"]}
      ],
      "negative_test": "C4 rejects EXECUTION-ADMISSION-DEFAULT-DENY-001 when a grant or hook semantic is partial or bypassable",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    }
  ]
}
```

An amendment, review finding, or compression may set a record to `amended` or `removed` only when its `authorising_design_lock` names that invariant, states the replacement or disposal, and gives the rationale. A repeated semantic finding must carry `regression_of` with the original invariant ID. The registry is cumulative; resolving, outdating, or superseding a review thread never deletes its invariant obligation.

## Default-deny Fast and agent admission reference contract

The default result without a valid grant is root-only Standard execution. The Web Orchestrator creates a grant only after an explicit current-turn user request. The structured grant is current-turn only, short-lived, non-inheritable, non-replayable, consumed only by its bound operation, and binds these exact fields: `run_id`, `session_id`, `turn_id`, `issuer`, `explicit_current_turn_user_request`, `operation`, `allow_fast`, `allow_agents`, `max_agents`, `provider`, `canonical_model`, `reasoning`, `expires_at`, `consumed`, and `inheritance: false`. Natural-language speed wording is not interpreted by the hook.

For ordinary `Agent` and `spawn_agent`, an installed trusted pre-launch `PreToolUse` hook must match before launch. Its verified identity includes installed state, event, matcher, version, exact bytes, trust, and runtime coverage. `SubagentStart` is audit-only. Missing, stale, malformed, untrusted, or unsupported coverage returns root-only Standard; specialised or bypass paths return `UNSUPPORTED_DELEGATION` or denial and cannot silently launch. This source-only PR does not install or activate the hook.
