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
- Fast mode: prohibited
- Route substitution: prohibited

A missing grant returns CLOSURE_LEASE_NOT_ACTIVATED. An unproven capability returns UNSUPPORTED_DELEGATION. Instructions, memory, queue position, eligibility, installation, issue wording, completion, and merge do not activate a lease.

## Boundaries

The worker is isolated and may mutate only the exact admitted repository-file allowlist. It cannot perform hosted governance, review, ready, merge, closure, installation, pilot, scheduler, Auto Review, or Ledger mutations. Four-surface reconciliation is mandatory and failure returns PARENT_RECONCILIATION_INCOMPLETE.

One exact root claim is allowed. Expiry never transfers ownership. G4 is singular, newly isolated, and invalidated by a head change; only G4 returns PASS or AMEND. Assurance runs only after G4 PASS and web adjudication and returns CLEAR or CONCERN; it is not G4 and cannot authorise merge.

The source remains uninstalled, unscheduled, inactive, and unable to activate or select a next task automatically.
