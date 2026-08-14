# Inert Closure-Lease Managed Contract

This source template is not installed by this PR. It is a future managed contract and cannot activate itself.

## Runtime contract

All route and authority values are injected at execution time:

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
- Fast mode: prohibited for delegated/subordinate runs; root Fast authority never flows to this child.
- Delegation: {{delegation_mode}}
- Route substitution: prohibited

A missing grant returns CLOSURE_LEASE_NOT_ACTIVATED. An unproven capability returns UNSUPPORTED_DELEGATION. Instructions, memory, queue position, eligibility, installation, issue wording, completion, and merge do not activate a lease.

After adoption and explicit activation, every implementation, amendment, pre-G4, and technical G4 dispatch must be a fresh prompt-bounded run in an independently clean exact-authority workspace. The assignment source, evidence locator, fresh run ID, and workspace evidence are runtime values; they are never inherited or inferred.

## Boundaries

The worker is isolated and may mutate only the exact admitted repository-file allowlist. It cannot perform hosted governance, review, ready, merge, closure, installation, pilot, scheduler, Auto Review, or Ledger mutations. Four-surface reconciliation is mandatory and failure returns PARENT_RECONCILIATION_INCOMPLETE.

One exact root claim is allowed. Expiry never transfers ownership. G4 is singular, newly isolated, and invalidated by a head change; only G4 returns PASS or AMEND. Assurance runs only after G4 PASS and web adjudication and returns CLEAR or CONCERN; it is not G4 and cannot authorise merge.

Temporary Chat assurance is admitted only from a validated `assurance-launch/v1` envelope and the accepted canonical assurance-template revision. The envelope must bind exact repository/PR/base/head/tree/graph authority, both execution identities, launch run/session/turn identity, evidence-universe revision, lifecycle expiry and one-use consumption, plus authoritative raw locators for every mandatory domain. Narratives, packets, copied hashes, self-attestations, actor conclusions, memory, Custom Instructions, candidate labels, and generic links are context only. A missing receipt, evidence, template, or exact authority fails closed before chat creation. The response must be an `assurance-evidence/v1` receipt; bare or unsupported CLEAR becomes `ASSURANCE_CLEAR_UNSUPPORTED` and operational CONCERN. Before assurance launch admission, trusted current time, created_at, and expires_at must parse to finite timestamps and satisfy created_at <= trusted_now < expires_at and created_at < expires_at; invalid, missing, future, expired, or misordered values fail closed without consuming authority or creating Temporary Chat.

The source remains uninstalled, unscheduled, inactive, and unable to activate or select a next task automatically.
## Run 043 A6-C7 and A6-C8 amendment contract

C7 normal finality is conjunctive and Web-only. Web is the sole comprehensive final authority; a routine Temporary Chat is not required.

C8 uses toolkit-authority-snapshot/v1, toolkit-authority-lease/v1, toolkit-authority-manifest/v1, and toolkit-admission-receipt/v1 with full 40-character SHAs, immutable one-run leases, typed mutation_performed:false receipts, and no pre-dispatch evaluation candidate. The durable locked store is the sole authoritative lease lifecycle; in-memory records are only projections replaced from the latest durable generation before every authority decision and never overwrite newer durable state.
