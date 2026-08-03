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

## Reviews, G4, and assurance

The final pre-G4 reviewer reports observations only. A technical G4 reviewer runs in a newly isolated context and is the sole source of PASS or AMEND for one exact head. A changed head invalidates the prior verdict and requires a fresh G4. Findings remain binding. The closure manager cannot suppress, overrule, reinterpret, or self-accept.

Conflicting, impossible, scope-expanding, or authority-expanding findings return to web. After G4 PASS and ordinary web adjudication, the independent assurance auditor returns CLEAR or CONCERN only. Assurance is not G4 and cannot authorise merge; CONCERN blocks acceptance pending web adjudication.

## Evaluation and cleanup

The evaluation-staging lane emits at most one public-safe candidate payload for the exact source revision. It contains no score, evaluation verdict, hidden reasoning, secret, environment value, private task/session identifier, managed-session identifier, or adapter-internal identifier. The worker does not write Ledger issues or claim a Ledger receipt.

Cleanup evidence must prove the module remains source-only, uninstalled, unscheduled, inactive, without a root claim, managed loop, automatic pickup, generated consumer surface, or orphan process. Completion and merge never activate or select a next task. A final report is evidence for web, not a G4 verdict.
