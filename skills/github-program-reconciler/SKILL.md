---
name: github-program-reconciler
description: Use for managed GitHub programme lifecycle intent, parent-child governance, deterministic preview/apply/readback reconciliation, exact-head review evidence, or Deferred Findings. Implicit invocation performs inspection and preflight only and never grants mutation, Ready, merge, or finality authority.
---

# GitHub Program Reconciler

Use this product whenever a request intends to inspect or change a managed GitHub programme lifecycle: parent/current-child state, child queue or dependencies, epoch/Lock, active candidate, programme labels, or finality handoff. Implicit discovery is mandatory preflight for those intents, but it grants only read-only inspection and preview.

Ordinary ungoverned GitHub metadata reads remain ordinary GitHub work. Ready, merge, review-thread mutation, owner decisions, Web finality, provider mutation, deployment, credentials, and live-system work remain outside this product.

## Runtime and authority

Use the one current runtime:

```text
node repo/scripts/toolkit-github-program-reconciler.cjs
```

The runtime is a deterministic local contract and transaction library. It ships no live GitHub provider client. Fixtures and host adapters inject authoritative current state and exact mutations.

Inspection and PREVIEW never mutate. APPLY requires a trusted host-injected authority verifier; a caller-authored `granted` flag is never authority. The verified grant binds the accepted preview ID, repository, parent, current revision and snapshot digest, desired-state digest, operation digest, and every stable operation ID. READBACK_VERIFY rereads every affected projection, label definition, managed event, and native relationship inventory and proves unrelated state was preserved. Stale, conflicting, partial, or unverifiable work fails with `PARENT_RECONCILIATION_INCOMPLETE`.

The successful immediate rerun must be `ZERO DELTA / ZERO MUTATION`.

## Predecessor coverage

Before architecture or queue reset, load `repo/contracts/github-program-predecessor-coverage.json`. It is bound to #359 comment `5437827030`, exactly 45 predecessor issues and 84 criterion groups. `UNMAPPED` is invalid; every transferred active criterion has a current owner. #246 optional work and #250 parked work remain discoverable outside the active completion graph unless Owner/Web reactivates them.

S6 must mechanically prove that no active transferred predecessor criterion remains unresolved before final whole-Toolkit assurance.

## Native relationships

Use current first-party GitHub semantics only:

- Parent-child truth comes from native sub-issues: inspect, add/adopt, remove, replace parent, and reprioritize where a trusted adapter inspection proves support and exact repository/issue identity.
- Dependency truth comes from native issue `blocked_by` inspection, add, and remove operations.
- Markdown links are supplemental context, not canonical native relationship truth.
- The managed `blocked` label is derived evidence only.
- Never create issues through relationship reconciliation. Preserve unrelated native relationships and remove only relationships marked as programme-managed.
- Unsupported or caller-asserted capabilities fail closed; never invent a pseudo-native endpoint.

## PR association safety

Maintain one deterministic `ACTIVE / ACCEPTED / RETIRED` registry. A Development or closing-keyword association can close an issue when its PR merges into the default branch, so only a terminal PR that genuinely completes the child may receive a closing association. Intermediate PRs use safe cross-reference or timeline evidence.

## Materialised views

- Parent body: compact programme dashboard, one-line outcome, current child, child graph table, major holds, predecessor gateway table, and next action.
- Child body: durable operating contract, one-line outcome, parent/dependencies, status/current obligation, epoch/Lock and PR-registry tables, predecessor mapping, exact candidate, boundaries/finality, and next action.
- PR body: concise lane with one-line outcome, parent/child, epoch/Lock, exact branch/base/head/tree and role tables, changed surfaces, validation, holds, and finality.

The portable minimum and additive repository-extension contract is `repo/contracts/github-program-reconciler/programme-surface-contract.json`. Repository-specific `extensions` may add detail but may not replace portable fields.

Any authorised transition that changes a represented current field must update the body projection in the same transaction. Comment-only current-state changes are incomplete.

## Managed chronology

Only typed managed events are machine authority: `lifecycle_transition`, `lock_accepted`, `candidate_bound`, `validation`, `g4_or_finality`, `blocker`, `dependency`, `owner_decision`, and `reconciliation_receipt`. Each event binds repository/entity identity, exact revision, resulting state, authority reference, and prior event or epoch where applicable. Stable event IDs are authoritative inventory: duplicates, altered events, missing readback events, or an event-bearing rerun that would append again fail closed. Similar-looking arbitrary prose is not authority.

## Labels and conformance

Every child has exactly one managed lifecycle label: `completed`, `current`, `queued`, or evidence-backed `blocked`. Preserve unrelated labels, reconcile the four label definitions, remove stale mutually exclusive managed labels, fail closed on multiple current children, and prefer native closure.

Classify repositories as `UNMANAGED`, `LEGACY_MANAGED`, `CURRENT_MANAGED`, or `DRIFTED_MANAGED`. Initialisation or migration is inspect -> preview -> explicit authority -> write -> readback -> zero-delta rerun. A stale unmanaged projection may be replaced only when an exact repository/entity/body/span digest and Web adjudication bind a recognised projection span; arbitrary owner policy can never be selected by prefix/suffix arithmetic. Preserve unrelated content. Recognised legacy parsing exists only for bounded migration; it is not a second truth or permanent compatibility runtime.

## Review truth and finality

Preserve the accepted server-authoritative review inventory, finding evidence, Deferred Findings, A1-A4, and repository-consent boundaries. Empty, stale, partial, caller-invented, or unverifiable review evidence is not green. Executors may inspect and recommend but must not reply to or resolve review threads, dismiss reviews, mark Ready, merge, manufacture finality, or choose the next current child autonomously.

Return a compact packet with repository/parent identity, conformance, predecessor coverage, preview/current bindings, exact delta, authority boundary, apply/readback result, zero-delta rerun result, failures, and exactly one controller-owned next action.
