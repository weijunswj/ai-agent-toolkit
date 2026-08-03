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
