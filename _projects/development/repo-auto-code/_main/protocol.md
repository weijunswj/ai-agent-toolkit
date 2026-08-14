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
- Assignment source: {{assignment_source}}
- Assignment evidence locator: {{assignment_evidence_locator}}
- Fresh subordinate run ID: {{fresh_subordinate_run_id}}
- Fresh workspace evidence locator: {{fresh_workspace_evidence_locator}}
- Fast mode: {{fast_mode}}
- Delegation: {{delegation_mode}}
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

Before an external review is requested or consumed, bind its identity to repository + PR + exact head SHA + external-review capability. Authoritative hosted evidence must prove the supported review type, actor, and mechanism; candidate labels, `rawEvidence`, and capability strings are not capability proof. The exact identity must have exactly one usable pending or completed state. An unusable, stale, unbound, duplicate, or ambiguous review does not satisfy the gate. On an unchanged identity, one usable pending review suppresses a duplicate trigger; one usable completed review is consumed and its findings are adjudicated without retriggering. Review or model limit exhaustion returns REVIEW_LIMIT_EXHAUSTED, never PASS. A changed head creates a new identity and requires a new usable external review and a newly isolated G4.

A technical G4 reviewer runs in a newly isolated context and is the sole source of PASS or AMEND for one exact head. It never implements repository changes. During every AMEND cycle it sends one complete finding batch to the closure manager and must not reply to or resolve review threads. Only after technical PASS on the final exact head may it send a bounded, evidence-backed technical reply; all threads remain unresolved. It never marks ready, accepts, merges, closes, deletes a branch, installs, activates a pilot, or selects another task. A changed head invalidates the prior verdict and requires a fresh G4. Findings remain binding. The closure manager cannot suppress, overrule, reinterpret, or self-accept.

Before the comprehensive C7 Web final gate, Web independently rereads and verifies the exact repository, branch, base, head, tree, complete commit graph, cumulative diff, file allowlist, source-only boundary, local validation, hosted checks, all review submissions and threads, every finding-to-code/test/evidence mapping, and the absence of unexpected authority or governance movement. Until this verification is recorded, C7 finality is WEB_VERIFICATION_REQUIRED. An exceptional assurance dispatch also requires its separate explicit grant and exact machine admission.

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

After adoption and activation, exactly one persistent Executor-root coordinates prompt-bounded implementation, amendment, pre-G4, and G4 runs. Every subordinate run starts fresh with a newly resolved assignment and an independently clean exact-authority worktree. The admitted subordinate role allowlist is exactly `implementation`, `amendment`, `pre-g4`, and `technical-g4`; any other run kind returns SURFACE_TOPOLOGY_INVALID. The root only collects and reconciles evidence packets; persistence is not implementation or governance authority. A retained, dirty, inherited, or ambiguous workspace returns SURFACE_TOPOLOGY_INVALID.

A fresh Web Temporary Chat is eligible only after final exact-head technical PASS and independent Web verification. It is read-only and returns exactly CLEAR or CONCERN. It cannot return PASS or AMEND, mutate hosted governance, authorise merge, or select work.

## A6 model-assignment resolution

For every dispatch, resolve one complete assignment from one source. The latest applicable complete explicit user assignment in the current persistent Web Orchestrator chat wins. Only when no applicable current-chat assignment exists may the Web Orchestrator fall back to the complete, unambiguous current canonical Custom Instructions repository, file, ref or commit, and blob. A current-chat assignment that is present but partial, conflicting, or ambiguous returns MODEL_ASSIGNMENT_REQUIRED; it must not fall through. Current-chat and Custom Instructions values are never combined.

The rendered prompt records assignment source and assignment evidence locator. Provider, canonical base model, reasoning, Sol-equivalent reasoning, role, surface, repository, and exact authority remain explicit runtime values. Memory, preference, cost, capability, benchmarks, issue wording, prior runs or chats, and availability cannot select or suggest a model. An unselected alternative returns MODEL_ASSIGNMENT_REQUIRED. No dispatch occurs until the source and evidence are complete and bound.

A6-C2 is a narrow source-only implementation exception for this continuing G3 chat and retained worktree. It is not activation, not a persistent Executor-root, and not a future runtime workspace-reuse rule.

## Model-neutral G4 and Web Temporary Chat contract

`technical G4 reviewer` is the structural term for the technical-review function. G4 is not a model name. The reviewer resolves its provider, canonical base model, and reasoning independently from the one controlling assignment source for that dispatch. A directly assigned G4 provider or model may differ from the Web controller. Historical model identities in retained evidence remain truthful historical values. Model, role, reasoning, and surface identity never grant authority.

After a final exact-head technical `PASS`, C7 does not require a routine Temporary Chat. Normal finality is conjunctive: review/amend convergence, one fresh exact-head G4 `PASS`, a complete terminal packet, and a comprehensive independent Web final gate must all be current and non-contradictory. The A6-C3/A6-C6 assurance launch and receipt remain available only as an explicitly pre-authorized exceptional evidence path for cryptography, recovery, irreversible or destructive migration, critical security boundaries, or conflicting evidence.

The Temporary Chat returns only `CLEAR` or `CONCERN`. It is not G5, does not replace G4, and has no GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority. G4 `PASS` is necessary but insufficient for `CLEAR`.

## A6-C6 assurance launch envelope and evidence receipt

The Web Orchestrator must admit assurance through two closed records. The launch record is `assurance-launch/v1`; the Temporary Chat result record is `assurance-evidence/v1`. Neither record may use a candidate-supplied `rawEvidence`, `valid`, `verified`, `accepted`, or equivalent label as proof. Decisions are derived from the structured authority, locator, identity, digest, inspection, lifecycle, and receipt fields below.

### `assurance-launch/v1`

The launch envelope is valid only when it contains all of these fields bound to the same live authority:

- `schema`, unique `envelope_id`, `repository`, `pull_request`, branch and merge-state identity, and exact `base`, `head`, `tree`, and commit-graph identity.
- `technical_g4_execution_identity` and `web_verification_execution_identity`, each with provider, canonical model, reasoning, assignment source and locator, role, surface, run/session/turn identity, and exact head.
- `launch_identity` with a fresh run, session, and turn; `canonical_template_revision` with the accepted assurance-template source, revision, and digest; and `evidence_universe_revision` with a revision or digest.
- `web_verification_receipt` with its exact-head recheck and evidence identity; `created_at`; `expires_at`; and a one-use lifecycle containing `state`, `consumed`, `use_count`, and `consumed_at`. Before assurance launch admission, trusted current time, created_at, and expires_at must parse to finite timestamps and satisfy created_at <= trusted_now < expires_at and created_at < expires_at; invalid, missing, future, expired, or misordered values fail closed without consuming authority or creating Temporary Chat.
- `evidence`, with exactly one record for each mandatory domain: `repository-pr-branch-merge`, `exact-authority-graph`, `cumulative-diff-allowlist`, `source-only-boundary`, `local-validation`, `hosted-checks-exact-head`, `review-submissions`, `review-threads`, `finding-mappings`, `governance-reconciliation`, `authority-movement`, and `applicable-archive-ledger-issue-state`.

Every mandatory evidence record contains `check_id`, an `authoritative_locator`, `evidence_identity`, `what_inspected`, `inspection_result`, and explicit contradiction/limitation fields. An authoritative locator is a resolved raw record, not a label: it contains `source_class: authoritative-raw`, an allowed raw source kind, an exact locator that resolves to the inspected subresource, a resolved evidence identity, a content digest, inspected subject, observation time, access state, repository, PR, and exact head. The inspected subject and digest must be bound to the domain and the current authority. Generic PR URLs, circular links, narrative references, copied packet hashes, or locators marked inaccessible do not satisfy a mandatory item.

The only acceptable proof class is `authoritative-raw` from the relevant repository, Git, hosted-check, review, issue, archive, digest, or Ledger source. The following classes are context only and are rejected as mandatory proof: `controller-narrative`, `web-narrative`, `g4-packet`, `executor-terminal-packet`, `copied-packet-hash`, `reviewer-self-attestation`, `actor-conclusion`, `memory`, `custom-instructions`, `candidate-label`, `generic-link`, and `circular-locator`.

Launch admission is ordered and fail closed. Missing `web_verification_receipt` returns `WEB_VERIFICATION_REQUIRED`. Missing, unresolved, inaccessible, or source-class-invalid mandatory evidence returns `ASSURANCE_EVIDENCE_INCOMPLETE`. A moved or mismatched repository, PR, branch, merge state, base, head, tree, graph, or authority returns `ASSURANCE_HEAD_MISMATCH`. Missing or stale canonical template revision returns `ASSURANCE_TEMPLATE_REQUIRED`. Duplicate, replayed, expired, consumed, or otherwise non-one-use envelopes return `ASSURANCE_LAUNCH_INVALID`. None of these states creates Temporary Chat.

The Web assurance dispatch is rendered only from the accepted canonical assurance-template bytes and the admitted launch envelope. The template must instruct the Temporary Chat to independently inspect authoritative evidence, reject supplied conclusions as proof, return `CONCERN` for missing access or evidence, claim verification only when inspection occurred, and retain no G4, GitHub, acceptance, ready, merge, closure, installation, activation, or next-task authority. A hand-written summary-consistency prompt is not an assurance dispatch.

### `assurance-evidence/v1`

The result receipt must contain `schema`, a verdict exactly `CLEAR` or `CONCERN`, repository/PR/base/head/tree, `launch_envelope_identity`, the fresh Temporary Chat execution identity and assignment provenance, the technical G4 execution identity, complete prohibited-context separation evidence, one check record for every mandatory domain, `missing_evidence`, a final-head recheck, receipt creation identity/time/sequence, and a non-authority attestation. Each check record repeats `check_id`, authoritative locator, evidence identity or digest, what was inspected, inspection result, contradiction, and limitation. The check locator and evidence identity must match the admitted launch universe.

The separation evidence must enumerate and independently prove separation from the Web Orchestrator, Executor-root, implementation, amendment, and technical G4 contexts. The final-head recheck must match the launch authority. The non-authority attestation must explicitly deny G4 PASS/AMEND authority, GitHub mutation, acceptance, ready, merge, closure, installation, activation, and next-task selection.

Web independently validates the receipt before using it. A bare verdict, empty check list, missing identity, missing separation evidence, missing final recheck, generic/narrative/circular/inaccessible locator, missing mandatory item, contradictory inspection, stale head, launch mismatch, or missing non-authority attestation cannot support `CLEAR`. Web returns `ASSURANCE_CLEAR_UNSUPPORTED`, treats the operational result as `CONCERN`, and does not convert it into technical `AMEND`, G5, acceptance, or merge authority. A complete evidence-backed `CONCERN` remains `CONCERN` and follows the existing Web concern-disposition path.

## Cumulative semantic invariant registry

The following JSON block is the machine-readable cumulative source contract. Every record must retain all seven fields. `required_semantics` and `candidate_evidence` are complete semantic bundles, not keyword lists. A missing field, missing bundle member, weakened description, keyword-only substitute, or negative-test mismatch returns `INVARIANT_REGRESSION`. A record with status `amended` must carry `design_lock_change.replacement` with a replacement invariant ID, semantic/evidence bundles, and its concrete negative-test reference; a record with status `removed` must carry `design_lock_change.disposal` with the invariant ID, disposal contract reference, and reason. Those contracts are validated instead of requiring the superseded semantic bundle byte-for-byte. Repeated parsed findings or invariant records must carry `regression_of` to a known invariant ID.

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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::AUTH-LEDGER-RECEIPT-001",
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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::SCHEMA-EVAL-CANDIDATE-001",
        "candidate_schema_mapping": {
          "base_model": "canonical_base_model",
          "revision": "source_revision",
          "result": "technical_result"
        },
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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::SCOPE-GOV-TRACKING-001",
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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::CONCURRENCY-GOV-WRITE-001",
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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::REVIEW-STATE-RECONCILIATION-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "G4-WEB-ASSURANCE-001",
      "source_authority": "A6-C3 model-neutral technical G4 and fresh Web assurance contract",
      "required_semantics": [
        {"semantic_id": "technical_function_and_independent_assignment", "requirement": "G4 is a technical-review function with an independently resolved provider, canonical model, and reasoning."},
        {"semantic_id": "fresh_assurance_after_verification", "requirement": "Exceptional assurance requires an exact explicit pre-dispatch grant; when granted, one fresh Temporary Chat follows final exact-head PASS and independent Web verification."},
        {"semantic_id": "bounded_non_authority", "requirement": "The Temporary Chat independently checks evidence, records both execution identities, returns only CLEAR or CONCERN, and has no finality or GitHub authority."}
      ],
      "candidate_evidence": [
        {"semantic_id": "technical_function_and_independent_assignment", "evidence_fields": ["g4_role", "g4_provider", "g4_canonical_model", "g4_reasoning", "assignment_source"]},
        {"semantic_id": "fresh_assurance_after_verification", "evidence_fields": ["assurance_grant", "g4_verdict", "final_exact_head", "web_verified", "fresh_temporary_chat_count"]},
        {"semantic_id": "bounded_non_authority", "evidence_fields": ["g4_execution_identity", "web_execution_identity", "independent_evidence", "verdict", "merge_authority"]}
      ],
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::G4-WEB-ASSURANCE-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "ASSURANCE-EVIDENCE-ENFORCEMENT-001",
      "source_authority": "A6-C6 assurance launch and receipt enforcement contract",
      "required_semantics": [
        {"semantic_id": "closed_launch_envelope", "requirement": "Exceptional Temporary Chat creation requires an exact grant and one exact-head assurance-launch/v1 envelope with bound identities, template and evidence revisions, expiry, and one-use state."},
        {"semantic_id": "authoritative_raw_domain_proof", "requirement": "Every mandatory assurance domain is proved by an accessible authoritative raw locator that identifies the exact inspected evidence and digest; narratives and packets are context only."},
        {"semantic_id": "structured_receipt_admission", "requirement": "Web admits only an assurance-evidence/v1 receipt with every check, exact launch/head identity, context separation, final recheck, and non-authority attestation; unsupported CLEAR becomes operational CONCERN."}
      ],
      "candidate_evidence": [
        {"semantic_id": "closed_launch_envelope", "evidence_fields": ["launch_schema", "repository", "pull_request", "base", "head", "tree", "commit_graph", "g4_execution_identity", "web_verification_execution_identity", "launch_identity", "template_revision", "evidence_universe_revision", "created_at", "expires_at", "consumed", "use_count"]},
        {"semantic_id": "authoritative_raw_domain_proof", "evidence_fields": ["mandatory_domain_ids", "authoritative_locator", "source_class", "exact_locator", "evidence_identity", "content_digest", "what_inspected", "accessible"]},
        {"semantic_id": "structured_receipt_admission", "evidence_fields": ["receipt_schema", "verdict", "launch_envelope_identity", "temporary_chat_execution_identity", "technical_g4_execution_identity", "prohibited_context_separation", "checks", "missing_evidence", "final_head_recheck", "receipt_creation", "non_authority_attestation"]}
      ],
      "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::ASSURANCE-EVIDENCE-ENFORCEMENT-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C6"
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
        "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::EXECUTION-ADMISSION-DEFAULT-DENY-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C4"
    },
    {
      "invariant_id": "C7-FINALITY-WEB-GATE-001",
      "source_authority": "DL-329-AUTO-CODE-005-A6-C7 normal finality and Web sole final authority",
      "required_semantics": [
        {"semantic_id": "conjunctive_finality", "requirement": "Review/amend convergence, one fresh exact-head G4 PASS, a complete terminal packet, and comprehensive independent Web verification are all required at the same exact head."},
        {"semantic_id": "web_sole_final_authority", "requirement": "Web is the sole comprehensive final authority; root, manager, worker, reviewer, and assurance surfaces are evidence-only."},
        {"semantic_id": "contradiction_rejection", "requirement": "Root, manager, worker, reviewer, or assurance claims of finality, acceptance, merge, closure, waiver, or Web authority reject finality."},
        {"semantic_id": "direct_amend", "requirement": "Web may return AMEND directly for a live contradiction or missing predicate without a second technical review."},
        {"semantic_id": "routine_assurance_not_required", "requirement": "A routine Temporary Chat and CLEAR/CONCERN assurance are not normal-path finality predicates."}
      ],
      "candidate_evidence": [
        {"semantic_id": "conjunctive_finality", "evidence_fields": ["review_amend_converged", "fresh_exact_head_g4_pass", "terminal_packet_complete", "web_comprehensive_final_gate"]},
        {"semantic_id": "web_sole_final_authority", "evidence_fields": ["web_final_authority", "non_web_surfaces_evidence_only", "merge_authority"]},
        {"semantic_id": "contradiction_rejection", "evidence_fields": ["contradictory_role_claims", "waived_predicates", "finality_decision"]},
        {"semantic_id": "direct_amend", "evidence_fields": ["web_verdict", "amend_reason", "second_review_required"]},
        {"semantic_id": "routine_assurance_not_required", "evidence_fields": ["temporary_chat_required", "assurance_result_required", "normal_path_predicates"]}
      ],
      "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::C7-FINALITY-WEB-GATE-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C7"
    },
    {
      "invariant_id": "C8-AUTHORITY-SNAPSHOT-LEASE-001",
      "source_authority": "DL-329-AUTO-CODE-005-A6-C8 deterministic machine authority contract",
      "required_semantics": [
        {"semantic_id": "canonical_snapshot", "requirement": "toolkit-authority-snapshot/v1 is deterministic canonical JSON with sorted keys, normalized arrays, full SHAs, and a SHA-256 digest."},
        {"semantic_id": "relevant_projection", "requirement": "Admission compares only the child-keyed relevant child, PR, and parent-entry projection; unrelated sibling-parent movement is non-invalidating."},
        {"semantic_id": "immutable_one_run_lease", "requirement": "toolkit-authority-lease/v1 is immutable after sealing, one-run, duplicate-safe, expiry-bound, and cannot be replayed after consumption."},
        {"semantic_id": "machine_byte_agreement", "requirement": "GitHub and local machine authority collections agree byte-for-byte for base, head, tree, blobs, identity, scope, role, capabilities, and relevant revisions."},
        {"semantic_id": "manifest_round_trip", "requirement": "toolkit-authority-manifest/v1 renders and extracts with exact bytes and the same digest; malformed or altered manifests fail closed."}
      ],
      "candidate_evidence": [
        {"semantic_id": "canonical_snapshot", "evidence_fields": ["snapshot_schema", "canonical_bytes", "snapshot_digest", "full_sha_validation"]},
        {"semantic_id": "relevant_projection", "evidence_fields": ["child_key", "pr_revision", "parent_entry_revision", "unrelated_sibling_movement"]},
        {"semantic_id": "immutable_one_run_lease", "evidence_fields": ["lease_schema", "lease_digest", "lifecycle", "sealed_immutable", "consumed"]},
        {"semantic_id": "machine_byte_agreement", "evidence_fields": ["github_collection", "local_collection", "byte_for_byte_agreement", "mismatch_reason"]},
        {"semantic_id": "manifest_round_trip", "evidence_fields": ["manifest_schema", "rendered_bytes", "extracted_bytes", "round_trip_digest"]}
      ],
      "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::C8-AUTHORITY-SNAPSHOT-LEASE-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C8"
    },
    {
      "invariant_id": "C8-ADMISSION-MUTATION-BOUNDARY-001",
      "source_authority": "DL-329-AUTO-CODE-005-A6-C8 typed admission and sensitivity boundary",
      "required_semantics": [
        {"semantic_id": "typed_fail_closed_receipts", "requirement": "Every authority, manifest, lease, tooling, or sensitivity failure returns a typed admission receipt with mutation_performed false."},
        {"semantic_id": "pre_dispatch_no_candidate", "requirement": "A pre-dispatch tooling or authority failure creates no evaluation candidate and consumes no lease."},
        {"semantic_id": "sensitivity_handling", "requirement": "none, possible, and confirmed output classes redact/no-repeat values and distinguish credential rotation from non-credential containment."},
        {"semantic_id": "default_off_source_only", "requirement": "The machinery remains source-only, uninstalled, unscheduled, inactive, credential-free, and cannot enable Auto Review or automatic next-task pickup."}
      ],
      "candidate_evidence": [
        {"semantic_id": "typed_fail_closed_receipts", "evidence_fields": ["receipt_schema", "reason", "mutation_performed", "sensitive_value_omitted"]},
        {"semantic_id": "pre_dispatch_no_candidate", "evidence_fields": ["tooling_failure", "evaluation_candidate_created", "lease_consumed"]},
        {"semantic_id": "sensitivity_handling", "evidence_fields": ["classification", "redacted", "pause_affected_path", "rotation_disposition", "containment_disposition"]},
        {"semantic_id": "default_off_source_only", "evidence_fields": ["source_only", "installed", "scheduled", "auto_review", "next_task_pickup", "credentials"]}
      ],
      "negative_test": "repo/tests/repo-auto-code-design.test.cjs::negative::C8-ADMISSION-MUTATION-BOUNDARY-001",
      "status": "preserved",
      "authorising_design_lock": "DL-329-AUTO-CODE-005-A6-C8"
    }
  ]
}
```

An amendment, review finding, or compression may set a record to `amended` or `removed` only when its `authorising_design_lock` names that invariant, states the replacement or disposal, and gives the rationale. A repeated semantic finding must carry `regression_of` with the original invariant ID. The registry is cumulative; resolving, outdating, or superseding a review thread never deletes its invariant obligation.

## Default-deny Fast and agent admission reference contract

This cumulative execution-admission contract is controlled through `DL-329-AUTO-CODE-005-A6-C5`.

The default result without a valid grant is root-only Standard execution. Fast and delegation are separate permissions. The Web Orchestrator creates a grant only after an explicit current-turn user request. The structured grant is current-turn only, short-lived, non-inheritable, non-replayable, consumed only by its bound operation, and binds these exact fields: `run_id`, `session_id`, `turn_id`, `issuer`, `explicit_current_turn_user_request`, `operation`, `allow_fast`, `allow_agents`, `max_agents`, `provider`, `canonical_model`, `reasoning`, `expires_at`, `consumed`, and `inheritance: false`. A delegation grant is valid only when `max_agents` is a positive finite integer and the requested count is a positive finite integer bounded by it. Natural-language speed wording is not interpreted by the hook.

The four permission outcomes are deterministic: `allow_fast=false, allow_agents=false` is root-only Standard; `allow_fast=true, allow_agents=false` is root-only Fast; `allow_fast=false, allow_agents=true` keeps root and delegated agents Standard; and `allow_fast=true, allow_agents=true` may authorize root Fast while every delegated child remains Standard with `fastAllowed:false`. Root Fast authority never flows to a delegated child. Missing, malformed, stale, consumed, replayed, inherited, or mismatched grants remain denied. Current-execution admission additionally requires trusted active validity/lifecycle evidence whose observed time equals the authority `now`; a parseable caller-selected timestamp alone cannot prove freshness.

For ordinary `Agent` and `spawn_agent`, an installed trusted pre-launch `PreToolUse` hook must match before launch. Its verified identity includes installed state, event, matcher, version, exact bytes, trust, and runtime coverage. `SubagentStart` is audit-only. Missing, stale, malformed, untrusted, or unsupported coverage returns root-only Standard; specialised or bypass paths return `UNSUPPORTED_DELEGATION` or denial and cannot silently launch. This source-only PR does not install or activate the hook.
## A6-C7 normal finality and the Web final gate

This section supersedes any earlier normal-path wording that makes a Temporary Chat, a CLEAR/CONCERN result, or routine second assurance a required finality predicate.

The normal path is conjunctive and ordered: review/amend convergence is current; one fresh exact-head authoritative technical G4 `PASS` exists; the complete terminal packet is assembled; and Web performs the comprehensive independent final gate. Web is the sole comprehensive final authority. Web may return `AMEND` directly when any predicate is false, contradictory, stale, incomplete, or outside scope; no technical reviewer, root, manager, worker, or assurance surface may waive a missing predicate or claim acceptance, merge, closure, or finality.

The C7 finality predicate requires all of the following at the same exact head: current child, PR, and relevant parent-entry authority; current Design Lock and authorised scope; exact-base and exact-head/tree agreement; a fresh exact-head G4 `PASS`; no blocking review, check, movement, contradiction, or unresolved required finding; a complete terminal packet; and comprehensive independent Web verification of the live repository, PR, branch, graph, diff, scope, checks, reviews, threads, mappings, and safety boundary. These predicates are evaluated conjunctively, not by a majority, score, label, or fallback.

A root, closure manager, implementation/amendment worker, pre-G4 reviewer, technical G4 reviewer, or independent assurance auditor may report evidence only. Their claims of finality, acceptance, merge, closure, waiver, or Web authority are contradiction evidence and reject finality. Web can adjudicate evidence and return `AMEND` without a second technical review. A changed relevant authority, head, tree, scope, Design Lock, review state, or terminal-packet field requires re-admission and a fresh exact-head G4 where applicable.

A fresh Web Temporary Chat and CLEAR/CONCERN assurance are not required on this normal path; exceptional assurance remains grant-bound. A second reviewer is exceptional only when Web has an explicit pre-authorisation before dispatch for cryptography, recovery, an irreversible or destructive migration, a critical security boundary, or conflicting evidence; that reviewer is fresh, isolated, read-only, non-authoritative, and cannot replace Web finality.

## A6-C8 deterministic machine authority

C8 is source-only, uninstalled, unscheduled, inactive, and default-deny. It defines executable evidence contracts named `toolkit-authority-snapshot/v1`, `toolkit-authority-lease/v1`, `toolkit-authority-manifest/v1`, and `toolkit-admission-receipt/v1`.

The snapshot is deterministic canonical JSON with lexicographically sorted object keys, normalized sorted path and capability arrays, UTF-8 bytes, and a SHA-256 digest. It contains the repository owner/name; child issue number and authority revision; PR number and authority revision; cumulative Design Lock; canonical base SHA; exact remote head SHA; exact tree SHA; every authorised path with its full 40-character blob SHA; authorised source scope and empty output/write boundary; role and capabilities; and a task-authority projection containing only the relevant child, PR, and deterministic child-keyed parent-entry marker revision. Lease IDs, timestamps, expiry, lifecycle state, receipts, and unrelated sibling-parent chronology are excluded from the snapshot.

The one-run lease is a separate immutable record. It binds one snapshot digest, run identity, role, capabilities, issued and expiry times, and a lease identity; it transitions only DRAFT -> SEALED -> DISPATCHED -> ADMITTED -> COMPLETED or a terminal rejection. Sealed records are immutable. Duplicate dispatch, conflicting active leases, expiry, stale relevant authority, replay, consumed leases, malformed manifests, and invalid transitions fail closed with typed `toolkit-admission-receipt/v1` records and `mutation_performed:false`. The durable locked store is the sole authoritative lease lifecycle. In-memory records are only non-authoritative projections replaced from the latest recovered durable generation before every read, register, admit/transition, expire, complete/consume, conflict, and replay decision; they never overwrite newer durable state.

Machine authority is collected independently from GitHub and the local checkout. Base, head, tree, every authorised blob, repository/issue/PR identity, scope, role, capabilities, and relevant revisions must agree byte-for-byte; full 40-character Git object IDs are required and abbreviated or prefix-expanded values are invalid. Relevant authority projection compares only the task-keyed child, PR, and parent-entry values; unrelated sibling-parent movement does not invalidate an otherwise matching snapshot.

The `toolkit-authority-manifest/v1` is rendered and extracted with exact delimiters and canonical bytes. Prompt render/extract round trips must reproduce the same canonical manifest digest; truncation, alteration, duplicate JSON fields, delimiter corruption, or digest mismatch is a typed pre-dispatch failure. Tooling failure before dispatch creates no evaluation candidate and no lease consumption.

Visible-output handling is sensitivity-aware: `none` continues; `possible` is redacted and pauses only the affected Web classification path; `confirmed` emits `SECRET_EXPOSURE_DETECTED` without repeating the value. Confirmed credential exposure requires evidence-based rotation disposition; confirmed non-credential exposure requires containment, with unrelated work invalidated only for demonstrated shared exposure. No credential, secret, private value, installation, activation, scheduler, Auto Review, or automatic next-task pickup is introduced by this source contract.

## B1/B2 commit version-audit boundary

For a pull request, version auditing uses the true merge base of the target-branch tip and the candidate head, so unrelated commits added to the target branch are not treated as feature commits. A malformed or missing base/head reference fails closed; explicit controller audits retain the supplied canonical base-to-candidate range.

A material contract-bearing module change includes a changed toolkit.project.json contract value (such as writes, approval, routing, live-action, or equivalent behavioural authority), any root contract path declared by version_trigger_paths (for this module: README.md and SOURCE-MANIFEST.md), and the existing main/curated/published trigger paths. The audit compares the manifest contract with its version metadata removed: a material contract change requires a monotonic same-commit SemVer transition, while the version-field transition that satisfies that requirement is not recursively treated as another material contract change.

## C10 alpha review-request boundary

C10 is a source-only, default-deny boundary for all generic GitHub writers. Every final outbound byte sequence is Unicode-normalised and inspected for direct, case-folded, zero-width-obfuscated, quoted, fenced, or encoded forms of the configured review invocation before any mutation. A match fails closed with the typed code `CODEX_TRIGGER_TOKEN_FORBIDDEN`; the raw invocation is never stored in tracked source, tests, fixtures, templates, prompts, logs, terminal packets, commit messages, issue text, or PR text.

Exactly one dedicated structured operation may construct the invocation internally. It is unavailable to Web, the bootstrap manager, ordinary writers, and implementation/amendment workers. Admission requires the authoritative technical G4 role, the exact repository and PR, the exact admitted head and tree, terminal-success checks, an exact one-run grant, per-head idempotency, no prior request for that material head, immediate comment readback, durable grant consumption, and a PR-conversation target. this source-only run does not exercise this live operation.

The later technical G4 closure state machine is: inspect all applicable historical/current findings; verify genuine repair at the admitted head; admit at most one configured request per materially different head; await native review completion; adjudicate findings; route accepted amendments; and, only in FINAL after exact-head PASS, post bounded evidence-backed replies. G4 never resolves, reopens, dismisses, or otherwise changes conversations and never marks ready, merges, closes, or claims Web finality. Review-allowance exhaustion is a blocker, never PASS. Web alone owns conversation resolution and finality.

## C11 corrected live finding binding matrix

The following bindings are the current review subjects and are executable regression obligations:

| Thread | Exact subject | Regression contract |
| --- | --- | --- |
| PRRT_kwDOSTHjGM6WPZcj | routine Temporary Chat | C7 normal finality does not require routine Temporary Chat; exceptional assurance requires an exact explicit grant. |
| PRRT_kwDOSTHjGM6WPZco | verified Web execution identity | Finality uses independently verified Web identity and authoritative locators. |
| PRRT_kwDOSTHjGM6WPZcq | non-Git authority | GitHub and local non-Git authority are independently collected and compared. |
| PRRT_kwDOSTHjGM6WPZcv | admitted lease | Candidate creation requires an admitted live lease. |
| PRRT_kwDOSTHjGM6WPZcx | consumption time | Lease expiry uses actual transition and consumption time. |
| PRRT_kwDOSTHjGM6WPZc2 | sensitivity | Authored labels cannot downgrade confirmed sensitivity. |
| PRRT_kwDOSTHjGM6WPZc3 | typed no-mutation | Possible and confirmed sensitivity stops return typed no-mutation receipts. |
| PRRT_kwDOSTHjGM6WPZc9 | exceptional-review grant | Exceptional review binds authenticated Web authority, exact repository/PR/head/run/session/turn/expiry and one-use state. |
| PRRT_kwDOSTHjGM6WPZdE | locale-independent | Ordering uses deterministic locale-independent bytes or code points. |
| PRRT_kwDOSTHjGM6WPZdI | nested markers | Target-in-sibling and sibling-in-target marker nesting is rejected. |
| PRRT_kwDOSTHjGM6WPZdL | manifest role | Manifest run identity, role and capabilities bind to snapshot and lease. |
| PRRT_kwDOSTHjGM6WPZdP | sealed lease | Sealed lease bytes and digest are verified before every transition. |
| PRRT_kwDOSTHjGM6WPZdT | fresh second machine | Final reread is a fresh second machine-authority collection and exact comparison. |
| PRRT_kwDOSTHjGM6WPZdX | machine-mismatch receipt | Typed machine-mismatch receipts survive pre-dispatch. |
| PRRT_kwDOSTHjGM6WPZdc | embedded API-key | Embedded API-key detection catches ASCII-alphanumeric prefixes and excludes only narrow public schema/config names. |
| PRRT_kwDOSTHjGM6WPZdh | assurance envelope | Assurance envelopes are consumed atomically in durable authoritative state. |
| PRRT_kwDOSTHjGM6WPZdn | admission grant | Admission grants are consumed atomically in durable authoritative state. |
| PRRT_kwDOSTHjGM6WPZdu | cryptographic digest | Digest format is cryptographically valid and verified against resolved evidence bytes. |
| PRRT_kwDOSTHjGM6WPZd1 | Git object type | Git objects resolve to the expected type and every authorised path binds to the exact tree entry. |
## C11 default-deny delegation and exclusive Auto-code lifecycle

This section preserves DL-329-AUTO-CODE-005-A6-C6 and supersedes earlier generic launch wording. No agent, subagent, helper, reviewer, managed session, parallel lane or replacement worker launches without a structured current-run grant. The grant binds exact count, mode, role, provider, canonical model, reasoning, repository, current-execution validity evidence, workspace/checkout identity, mutation scope, capabilities, run/session/turn identity, expiry, one-use state and the further-delegation boundary. Before consuming an exclusive-worker grant, the requested launch must bind the exact repository, role, current execution/head/tree, workspace identity, requested count, canonical repo-relative scope, and requested capability subset; malformed, moved, stale, expired, revoked, future/impossible, or ungranted admin/governance requests reject without consumption. Complexity, capacity, expected speed-up, elapsed time, worker availability, host support, tool availability, silence, generic speed language and prior-turn permission never grant launch authority. Missing or incomplete authority returns DELEGATION_NOT_AUTHORISED. Further delegation requires a separate explicit grant.

Ordinary concurrent-helper mode remains available only under its own explicit grant and requires root work to be separate and non-overlapping. Exclusive Auto-code mode is separately selected and admits exactly one implementation/amendment worker with exclusive mutation ownership for its exact workspace and scope. The manager enters MANAGER_SUSPENDED_ON_NATIVE_WORKER and awaits the normal harness-native terminal result. Elapsed time, quiet output, absent file writes and bounded command-wait expiry are not failure signals. While the worker is active the manager must not inspect workspace progress, run overlapping validation, send status or continue nudges, interrupt for progress, take over mutation, or launch a replacement.

The manager resumes only when trusted terminal/resume evidence binds to the exact durable admitted worker launch currently owning the workspace: repository, PR/child task, run/session/turn, exact head/tree, exclusive-worker launch and grant identity with consumed/admitted state, worker identity, workspace/checkout, launch role, and terminal event identity. Static, stale, wrong-worker, wrong-workspace, replayed, incomplete, or unadmitted evidence leaves the manager suspended and transfers no mutation ownership. Normal return releases mutation ownership to the manager for validation, integration, commit and push. Replacement requires a new grant plus proven terminal failure or result loss. User interruption preserves the workspace and ownership state; it does not transfer implementation ownership automatically. This source-only module does not enable autonomous spawning.
