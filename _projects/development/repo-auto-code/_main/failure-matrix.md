# Failure Matrix

The controller and future adapters fail closed. A failure is evidence, not permission to continue.

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Missing or invalid explicit activation | CLOSURE_LEASE_NOT_ACTIVATED | No | Web |
| Adapter cannot prove a required role capability | UNSUPPORTED_DELEGATION | No | Web |
| Repository, branch, base, head, tree, PR, review, or lock moved | EXACT_AUTHORITY_MOVEMENT | No | Web |
| Required file is outside the admitted allowlist | SCOPE_AMBIGUITY | No | Web |
| Child, PR, parent, or chronology reconciliation is missing, stale, duplicate, partial, or moved | PARENT_RECONCILIATION_INCOMPLETE | No | Web |
| Another exact root exists, or expiry is used as a takeover | ROOT_OWNERSHIP_CONFLICT | No | Web |
| Root replacement lacks revocation or trusted terminal proof plus a new grant | ROOT_REPLACEMENT_NOT_AUTHORIZED | No | Web |
| Worker or helper attempts hosted governance or finality mutation | GOVERNANCE_MUTATION_PROHIBITED | No | Web |
| G4 context is not newly isolated | G4_ISOLATION_REQUIRED | No | Web |
| G4 verdict is absent, stale, duplicated, or attached to a different head | FRESH_G4_REQUIRED | No | Web |
| Manager suppresses, overrules, or reinterprets a G4 finding | G4_FINDING_BINDING | No | Web |
| Same root cause remains after the allowed amendment boundary | NON_CONVERGENCE | No | Web |
| Authority movement or an impossible, conflicting, or expanding finding is observed | USER_CONTROLLER_DECISION_REQUIRED | No | Web |
| Assurance runs before G4 PASS and web adjudication, or returns anything other than CLEAR or CONCERN | ASSURANCE_ORDER_INVALID | No | Web |
| Assurance returns CONCERN | ASSURANCE_CONCERN | No | Web until adjudicated |
| Evaluation payload is duplicated, private, revision-mismatched, graded, or written to Ledger | EVALUATION_STAGING_FAILURE | No | Web |
| Cleanup cannot prove no installed, scheduled, active, or orphaned surface | CLEANUP_UNPROVEN | No | Web |
| Completion or merge tries to select or activate another task | AUTOMATIC_NEXT_TASK_PROHIBITED | No | Web |

The implementation worker reports the exact code and raw evidence for the failure. It does not convert a failure into a pass, use a fallback default, or widen its scope.

## A4 review, assurance, and return conditions

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| External review is unbound, ambiguous, stale, unusable, or not attached to the exact review identity | EXTERNAL_REVIEW_UNUSABLE | No | Web |
| More than one usable pending or completed review matches the exact identity | EXTERNAL_REVIEW_AMBIGUOUS | No | Web |
| Hosted review type, actor, or supported mechanism cannot prove external-review capability | EXTERNAL_REVIEW_UNUSABLE | No | Web |
| A review/model limit is exhausted before a usable exact-head review is available | REVIEW_LIMIT_EXHAUSTED | No | Web |
| A materially changed head reuses the old review identity or skips the new review and isolated G4 | FRESH_HEAD_REVIEW_REQUIRED | No | Web |
| Authoritative G4 reviewer implements, replies during AMEND, resolves any thread, or sends an unbounded/non-evidence reply | G4_THREAD_BOUNDARY_VIOLATION | No | Web |
| A technical reply is attempted before explicit FINAL phase and every final exact-head PASS prerequisite | G4_EVIDENCE_REPLY_NOT_YET_ALLOWED | No | Web |
| Assurance runs before final G4 PASS, ordinary web adjudication, or mandatory web verification | WEB_VERIFICATION_REQUIRED | No | Web |
| CLEAR is treated as technical PASS, merge authority, or acceptance authority | ASSURANCE_NOT_MERGE_AUTHORITY | No | Web |
| CONCERN freezes independently proven unrelated dispositions or leaves insufficiently proven findings closed | ASSURANCE_CONCERN_DISPOSITION_INCOMPLETE | No | Web |
| A previously resolved thread is reopened without proven regression or contrary evidence, or by a non-web actor | RESOLVED_THREAD_REOPEN_PROHIBITED | No | Web |

Ordinary review findings and a provably terminated non-mutating worker remain inside the closure loop. Only these genuine closed blockers return to web: INTERRUPTED_SESSION_OWNERSHIP, EXACT_AUTHORITY_MOVEMENT, scope or Design Lock conflict, REVIEW_LIMIT_EXHAUSTED, NON_CONVERGENCE, secret exposure or required rotation, and a genuine user/controller decision. No blocker result may be treated as review success or technical PASS.

## A6 topology and model-assignment conditions

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Required Web Orchestrator or Executor-root is missing, duplicated, cross-task, cross-repository, cross-PR, replaced, unknown-type, extra, or unverifiable | SURFACE_TOPOLOGY_INVALID | No | Web |
| Persistent surface count is not exactly one Web Orchestrator plus one Executor-root for the current state | SURFACE_TOPOLOGY_INVALID | No | Web |
| Active or persistent surface exists while adoption or activation grants are incomplete | SURFACE_TOPOLOGY_INVALID | No | Web |
| Subordinate run is not fresh, prompt-bounded, independently clean, or exact-authority isolated after adoption | SURFACE_TOPOLOGY_INVALID | No | Web |
| Retained, dirty, inherited, or ambiguous workspace is reused after activation | SURFACE_TOPOLOGY_INVALID | No | Web |
| Temporary Chat is premature, not fresh, not read-only, returns a non-CLEAR/CONCERN result, or attempts hosted/finality authority | SURFACE_TOPOLOGY_INVALID | No | Web |
| A source change, merge, installation, or activation is treated as another grant | SURFACE_TOPOLOGY_INVALID | No | Web |
| Current-chat assignment is partial, conflicting, ambiguous, or unbound | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| Canonical Custom Instructions fallback is incomplete, ambiguous, unbound, or used despite a present current-chat assignment | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| Assignment values are mixed across sources or prompt provenance is absent | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| Model is inferred or suggested from memory, preference, cost, capability, benchmarks, issue wording, previous runs/chats, or availability | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| An unselected alternative model is introduced | MODEL_ASSIGNMENT_REQUIRED | No | Web |

The A6-C2 continuation is a narrow source-only bootstrap implementation exception. It does not satisfy adoption, does not activate a surface, and must never be used to bypass the post-adoption fresh-run rule.

## A6-C3 assurance failures

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| G4 is named or routed as a structural model instead of the technical-review function | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| G4 provider, canonical model, or reasoning is inferred from or inherited from the Web controller | MODEL_ASSIGNMENT_REQUIRED | No | Web |
| Final exact-head technical PASS lacks independent Web verification | WEB_VERIFICATION_REQUIRED | No | Web |
| Exceptional assurance is requested without an exact one-use grant | ASSURANCE_GRANT_REQUIRED | No | Web |
| Temporary Chat shares an implementation, Executor-root, Web Orchestrator, or G4 context | SURFACE_TOPOLOGY_INVALID | No | Web |
| Temporary Chat treats a G4 packet or self-attestation as proof, or omits an execution identity | ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED | No | Web |
| G4 or Web assurance identity omits provider, canonical model, reasoning, assignment provenance, role, surface, or exact head | ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED | No | Web |
| Temporary Chat does not prove separation from Web Orchestrator, Executor-root, implementation, amendment, and technical G4 contexts | SURFACE_TOPOLOGY_INVALID | No | Web |
| Temporary Chat returns a result other than CLEAR or CONCERN, or attempts finality authority | ASSURANCE_ORDER_INVALID | No | Web |
| G4 PASS is treated as CLEAR without the independent Temporary Chat result | ASSURANCE_ORDER_INVALID | No | Web |

## A6-C6 assurance launch and receipt enforcement

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Temporary Chat launch has no Web verification receipt | WEB_VERIFICATION_REQUIRED | No; no Temporary Chat | Web |
| Launch envelope omits, cannot resolve, or cannot access a mandatory raw evidence domain | ASSURANCE_EVIDENCE_INCOMPLETE | No; no Temporary Chat | Web |
| Launch repository, PR, branch, merge state, base, head, tree, graph, or authority moved or mismatches the live readback | ASSURANCE_HEAD_MISMATCH | No; no Temporary Chat | Web |
| Canonical assurance-template revision is missing, stale, or not used for rendering | ASSURANCE_TEMPLATE_REQUIRED | No; no Temporary Chat | Web |
| Launch envelope is duplicated, replayed, expired, already consumed, or used more than once | ASSURANCE_LAUNCH_INVALID | No; no Temporary Chat | Web |
| Any created_at, expires_at, or trusted current time is missing, non-finite, future-dated, expired, or fails created_at <= trusted_now < expires_at and created_at < expires_at | ASSURANCE_LAUNCH_INVALID | No; no Temporary Chat, no authority consumption or mutation | Web |
| A mandatory item is proved only by a narrative, G4 packet, executor packet, copied hash/count, self-attestation, actor conclusion, memory, Custom Instructions, candidate label, generic link, or circular locator | ASSURANCE_EVIDENCE_INCOMPLETE | No; no Temporary Chat | Web |
| Dispatch replaces the canonical repository-inspection assignment with a hand-written summary-consistency task | ASSURANCE_TEMPLATE_REQUIRED | No; no Temporary Chat | Web |
| Assurance response is bare, has no schema, has an empty check list, or omits required receipt identity/separation/non-authority fields | ASSURANCE_CLEAR_UNSUPPORTED | No; operational result is CONCERN | Web |
| Receipt claims CLEAR while a check is missing, generic, inaccessible, narrative-only, contradictory, stale, or listed as missing | ASSURANCE_CLEAR_UNSUPPORTED | No; operational result is CONCERN | Web |
| Receipt locator claims inspection while its authoritative evidence is inaccessible | ASSURANCE_CLEAR_UNSUPPORTED | No; operational result is CONCERN | Web |
| Receipt exact head or launch-envelope identity does not match the admitted launch | ASSURANCE_HEAD_MISMATCH or ASSURANCE_LAUNCH_INVALID | No; operational result is CONCERN | Web |

## A6-C4 invariant failures

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Invariant record omits an ID, source authority, complete semantics, candidate evidence, negative test, status, or Design Lock | INVARIANT_REGRESSION | No | Web |
| Candidate evidence is only a keyword, partial bundle, or weakened semantic substitute | INVARIANT_REGRESSION | No | Web |
| Negative test is missing, empty, unrelated, or not executable/mechanically mapped to the invariant | INVARIANT_REGRESSION | No | Web |
| An amendment or compression removes or weakens an invariant without a Design Lock naming the ID, replacement/disposal, and rationale | INVARIANT_REGRESSION | No | Web |
| An amended or removed invariant does not validate its named replacement or disposal contract | INVARIANT_REGRESSION | No | Web |
| An accepted review finding is dropped because its thread was resolved, out-dated, or superseded | INVARIANT_REGRESSION | No | Web |
| A repeated semantic finding lacks `regression_of` with the original invariant ID | INVARIANT_REGRESSION | No | Web |
| `regression_of` is missing for a repeated parsed finding or names an unknown invariant | INVARIANT_REGRESSION | No | Web |
| Invariant evidence cannot map to the canonical evaluation-candidate schema | INVARIANT_REGRESSION | No | Web |
| Mechanical compression passes but semantic invariant preservation fails | INVARIANT_REGRESSION | No | Web |
| Exact-head external-review completion is not reconciled across child, PR, one parent entry, and one new chronology comment | PARENT_RECONCILIATION_INCOMPLETE | No | Web |
| Review state is stale at the next prompt, G4, or finality boundary | REVIEW_STATE_STALE | No | Web |

## A6-C5 execution-admission failures

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Trusted current-execution validity is stale, expired, revoked, future/impossible, or moved, or `now` is only caller-selected parseable text | DELEGATION_NOT_AUTHORISED | No | Web |
| Exclusive worker request omits or mismatches repository, role, current run/session/turn/head/tree, validity evidence, or workspace/checkout identity | DELEGATION_NOT_AUTHORISED | No; grant remains unconsumed | Web |
| Requested exclusive-worker scope is absolute, drive-qualified, UNC, backslash, dot-segment, noncanonical, escaping, or exceeds the grant | SCOPE_MISMATCH or SCOPE_EXCEEDS_GRANT | No; grant remains unconsumed | Web |
| Requested exclusive-worker capability is omitted, malformed, ungranted, admin, or governance | CAPABILITY_MISMATCH or CAPABILITY_EXCEEDS_GRANT | No; grant remains unconsumed | Web |
| Delegated `spawn_agent` receives `allow_fast:true` or root Fast authority | AGENT_STANDARD with `fastAllowed:false` | Yes; Standard child only | Web |
| Fast or Agent/spawn_agent is requested without an exact current-turn grant | ADMISSION_DENIED | No | Web |
| Grant is absent because the prompt omitted an allowance, or only generic speed wording exists | ADMISSION_DENIED | No | Web |
| Grant run, session, turn, operation, provider, canonical model, reasoning, or count does not match | ADMISSION_DENIED | No | Web |
| Delegation grant has missing, zero, negative, fractional, infinite, string, or otherwise invalid `max_agents` | ADMISSION_DENIED | No | Web |
| Requested agent count is missing, non-positive, non-finite, non-integer, or exceeds `max_agents` | ADMISSION_DENIED | No | Web |
| Grant is stale, consumed, replayed, inherited, or has invalid expiry or consumption state | ADMISSION_DENIED | No | Web |
| Explicit Fast grant is valid but the operation is not bound to Fast | ADMISSION_DENIED | No | Web |
| Runtime template Fast/delegation values do not render the admitted structured grant | ADMISSION_DENIED | No | Web |
| Supported ordinary Agent/spawn_agent launch lacks a trusted pre-launch PreToolUse hook | ROOT_ONLY_STANDARD | No | Web |
| Hook is missing, stale, malformed, untrusted, or lacks verified runtime coverage | ROOT_ONLY_STANDARD | No | Web |
| SubagentStart is presented as prevention evidence | ROOT_ONLY_STANDARD | No | Web |
| Specialised or bypass launch path is not explicitly supported and admitted | UNSUPPORTED_DELEGATION | No | Web |

The source-only contract does not claim that a native hook is installed or operational. Host-specific installation and adapter wiring are separate authority and validation surfaces.
## A6-C7 finality failures

The C7 section supersedes earlier normal-path rows that require a Temporary Chat or an assurance CLEAR/CONCERN result.

| Condition | Return code | Mutation/evaluation effect | Owner |
| --- | --- | --- | --- |
| Review/amend convergence is not current at the exact head | REVIEW_STATE_STALE | No G4 or finality | Web |
| Fresh exact-head G4 PASS is absent, stale, or contradicted | G4_EXACT_HEAD_REQUIRED | No finality | Web |
| Complete terminal packet is missing or internally inconsistent | TERMINAL_PACKET_INCOMPLETE | No candidate or acceptance | Web |
| Comprehensive independent Web final gate is missing or incomplete | WEB_FINAL_GATE_REQUIRED | No acceptance, merge, or closure | Web |
| Any required C7 conjunct is false, moved, contradictory, or waived by a non-Web actor | FINALITY_CONJUNCT_FALSE | Return AMEND; no finality | Web |
| Root, manager, worker, pre-G4, G4, or assurance claims finality, acceptance, merge, closure, waiver, or Web authority | FINALITY_AUTHORITY_CONTRADICTION | Reject finality; preserve evidence | Web |
| Web returns AMEND for a live concern without a second technical review | AMEND | Return to the bounded review/amend loop | Web |
| Routine Temporary Chat or CLEAR/CONCERN is presented as a normal-path predicate | ROUTINE_ASSURANCE_NOT_REQUIRED | Ignore the routine path; no authority transfer | Web |
| Exceptional second reviewer lacks an explicit pre-dispatch grant or exceeds its named category | EXCEPTIONAL_REVIEW_NOT_AUTHORISED | No dispatch or finality | Web |

## A6-C8 authority, manifest, lease, and sensitivity failures

| Condition | Return code | Mutation/evaluation effect | Owner |
| --- | --- | --- | --- |
| SHA is not exactly 40 lowercase hexadecimal characters | MALFORMED_SHA | No admission, no candidate | Web |
| Blob, base, head, or tree is abbreviated, truncated, or prefix-expanded | MALFORMED_SHA | No admission, no candidate | Web |
| Machine GitHub/local base differs | BASE_MOVED | Stop and preserve | Web |
| Machine GitHub/local head differs | HEAD_MOVED | Stop and preserve | Web |
| Machine GitHub/local tree differs | TREE_MOVED | Stop and preserve | Web |
| An authorised blob differs or is missing | BLOB_MOVED | Stop and preserve | Web |
| Repository, issue/PR identity, scope, role, or capability differs | SCOPE_MISMATCH | Stop and preserve | Web |
| Child authority revision changed | CHILD_AUTHORITY_MOVED | Re-admit; no candidate | Web |
| PR authority revision changed | PR_AUTHORITY_MOVED | Re-admit; no candidate | Web |
| Relevant child-keyed parent marker changed, duplicated, nested, or mismatched | PARENT_ENTRY_MOVED | Re-admit; no candidate | Web |
| Unrelated sibling-parent chronology changed while the relevant projection is stable | UNRELATED_PARENT_MOVEMENT | Do not invalidate relevant admission | Web |
| Snapshot bytes or digest differ | SNAPSHOT_DIGEST_MISMATCH | No lease dispatch or candidate | Web |
| Manifest schema, duplicate fields, delimiter, canonical bytes, or digest is invalid | MALFORMED_MANIFEST | No lease consumption or candidate | Web |
| Prompt render/extract changes canonical manifest bytes | MANIFEST_ROUND_TRIP_MISMATCH | No dispatch or candidate | Web |
| Lease is duplicated, replayed, already consumed, or conflicts with an active lease | DUPLICATE_DISPATCH / LEASE_ALREADY_CONSUMED / CONFLICTING_ACTIVE_LEASE | No second run | Web |
| Lease has expired or transition is invalid | LEASE_EXPIRED / LEASE_INVALID | No admission or candidate | Web |
| Durable locked lease state is newer than an in-memory projection | LEASE_ALREADY_CONSUMED / LEASE_EXPIRED / CONFLICTING_ACTIVE_LEASE as applicable | Reload and act on durable state; never resurrect or rewrite an older terminal or consumed state | Web |
| Pre-dispatch tooling, collection, extraction, or final reread fails | PRE_DISPATCH_TOOLING_FAILURE | `evaluation_candidate_created:false`; no lease consumption | Web |
| Visible output is possible-sensitive | SENSITIVITY_POSSIBLE | Redact/no-repeat; pause affected Web path only | Web |
| Confirmed credential exposure lacks evidence-based rotation disposition | SECRET_EXPOSURE_DETECTED | Stop affected path; contain/rotate per evidence | Web |
| Confirmed non-credential exposure lacks containment | SECRET_EXPOSURE_DETECTED | Stop affected path; contain per evidence | Web |
| Shared exposure is not demonstrated | SENSITIVITY_LOCAL_ONLY | Do not invalidate unrelated work | Web |

## C11 exact worker-launch terminal provenance failures

| Condition | Return code | Mutation/evaluation effect | Owner |
| --- | --- | --- | --- |
| Terminal/resume evidence is static, missing, malformed, unadmitted, bound to the wrong grant/launch/worker/workspace/run/session/turn/head/tree, stale, or replayed | DELEGATION_NOT_AUTHORISED / MANAGER_SUSPENDED_ON_NATIVE_WORKER | No manager ownership transfer; preserve the active or terminal durable launch state | Web |
| Exact admitted worker launch has a valid normal terminal, permitted harness failure/result loss, user interruption, or governed authority-movement event | MANAGER_READY_FOR_VALIDATION or governed replacement state | Transfer only the exact workspace mutation ownership proven by that launch; replacement requires a fresh exact grant | Web |
| Material module contract change lacks a monotonic same-commit version transition | NO_VERSION_TRIGGER / VERSION_NOT_INCREASED | Reject the audit; the module version gate is not bypassed | CI/Web |
| The version metadata transition is the same-commit remedy for a material module contract change | NO_VERSION_TRIGGER_VERSION_TRANSITION_OBSERVED | Accept the trigger without recursively requiring another version change | CI/Web |

No row permits installation, activation, scheduling, Auto Review, automatic next-task pickup, credential introduction, or governance mutation. All typed admission receipts carry `mutation_performed:false` and must not repeat sensitive observed values.
