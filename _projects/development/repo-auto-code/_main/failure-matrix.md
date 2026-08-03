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
| A review/model limit is exhausted before a usable exact-head review is available | REVIEW_LIMIT_EXHAUSTED | No | Web |
| A materially changed head reuses the old review identity or skips the new review and isolated G4 | FRESH_HEAD_REVIEW_REQUIRED | No | Web |
| Authoritative G4 reviewer implements, replies during AMEND, resolves any thread, or sends an unbounded/non-evidence reply | G4_THREAD_BOUNDARY_VIOLATION | No | Web |
| A technical reply is attempted before final exact-head PASS | G4_EVIDENCE_REPLY_NOT_YET_ALLOWED | No | Web |
| Assurance runs before final G4 PASS, ordinary web adjudication, or mandatory web verification | WEB_VERIFICATION_REQUIRED | No | Web |
| CLEAR is treated as technical PASS, merge authority, or acceptance authority | ASSURANCE_NOT_MERGE_AUTHORITY | No | Web |
| CONCERN freezes independently proven unrelated dispositions or leaves insufficiently proven findings closed | ASSURANCE_CONCERN_DISPOSITION_INCOMPLETE | No | Web |
| A previously resolved thread is reopened without proven regression or contrary evidence, or by a non-web actor | RESOLVED_THREAD_REOPEN_PROHIBITED | No | Web |

Ordinary review findings and a provably terminated non-mutating worker remain inside the closure loop. Only these genuine closed blockers return to web: INTERRUPTED_SESSION_OWNERSHIP, EXACT_AUTHORITY_MOVEMENT, scope or Design Lock conflict, REVIEW_LIMIT_EXHAUSTED, NON_CONVERGENCE, secret exposure or required rotation, and a genuine user/controller decision. No blocker result may be treated as review success or technical PASS.

## A6 topology and model-assignment conditions

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Required Web Orchestrator or Executor-root is missing, duplicated, cross-task, cross-repository, cross-PR, replaced, or unverifiable | SURFACE_TOPOLOGY_INVALID | No | Web |
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
| Final exact-head PASS has no Temporary Chat or has more than one exact-head Temporary Chat | TEMPORARY_ASSURANCE_REQUIRED | No | Web |
| Temporary Chat shares an implementation, Executor-root, Web Orchestrator, or G4 context | SURFACE_TOPOLOGY_INVALID | No | Web |
| Temporary Chat treats a G4 packet or self-attestation as proof, or omits an execution identity | ASSURANCE_EVIDENCE_INDEPENDENCE_REQUIRED | No | Web |
| Temporary Chat returns a result other than CLEAR or CONCERN, or attempts finality authority | ASSURANCE_ORDER_INVALID | No | Web |
| G4 PASS is treated as CLEAR without the independent Temporary Chat result | ASSURANCE_ORDER_INVALID | No | Web |

## A6-C4 invariant failures

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Invariant record omits an ID, source authority, complete semantics, candidate evidence, negative test, status, or Design Lock | INVARIANT_REGRESSION | No | Web |
| Candidate evidence is only a keyword, partial bundle, or weakened semantic substitute | INVARIANT_REGRESSION | No | Web |
| An amendment or compression removes or weakens an invariant without a Design Lock naming the ID, replacement/disposal, and rationale | INVARIANT_REGRESSION | No | Web |
| An accepted review finding is dropped because its thread was resolved, out-dated, or superseded | INVARIANT_REGRESSION | No | Web |
| A repeated semantic finding lacks `regression_of` with the original invariant ID | INVARIANT_REGRESSION | No | Web |
| Mechanical compression passes but semantic invariant preservation fails | INVARIANT_REGRESSION | No | Web |
| Exact-head external-review completion is not reconciled across child, PR, one parent entry, and one new chronology comment | PARENT_RECONCILIATION_INCOMPLETE | No | Web |
| Review state is stale at the next prompt, G4, or finality boundary | REVIEW_STATE_STALE | No | Web |

## A6-C5 execution-admission failures

| Condition | Required result | Continue? | Repair owner |
| --- | --- | --- | --- |
| Fast or Agent/spawn_agent is requested without an exact current-turn grant | ADMISSION_DENIED | No | Web |
| Grant is absent because the prompt omitted an allowance, or only generic speed wording exists | ADMISSION_DENIED | No | Web |
| Grant run, session, turn, operation, provider, canonical model, reasoning, or count does not match | ADMISSION_DENIED | No | Web |
| Grant is stale, consumed, replayed, inherited, or has invalid expiry or consumption state | ADMISSION_DENIED | No | Web |
| Explicit Fast grant is valid but the operation is not bound to Fast | ADMISSION_DENIED | No | Web |
| Supported ordinary Agent/spawn_agent launch lacks a trusted pre-launch PreToolUse hook | ROOT_ONLY_STANDARD | No | Web |
| Hook is missing, stale, malformed, untrusted, or lacks verified runtime coverage | ROOT_ONLY_STANDARD | No | Web |
| SubagentStart is presented as prevention evidence | ROOT_ONLY_STANDARD | No | Web |
| Specialised or bypass launch path is not explicitly supported and admitted | UNSUPPORTED_DELEGATION | No | Web |

The source-only contract does not claim that a native hook is installed or operational. Host-specific installation and adapter wiring are separate authority and validation surfaces.
