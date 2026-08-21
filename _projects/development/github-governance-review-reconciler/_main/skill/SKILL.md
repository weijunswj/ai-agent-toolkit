---
name: github-governance-review-reconciler
description: Explicit-only current-main N5 GitHub parent/direct-child governance and truthful PR-review/Deferred Findings reconciliation.
---

# N5 GitHub Governance and Truthful PR-Review Reconciler

This skill is explicit-only. Its OpenAI metadata sets `allow_implicit_invocation: false`.
Use it only when the user explicitly asks for the current-main N5 governance and
truthful PR-review reconciler contract for a repository-scoped task. Ordinary
GitHub inspection belongs to the GitHub skill, ordinary coding belongs to the
coding agent, and final Web/controller work remains outside this skill.

## Scope

The supported intents are `inspect`, `preview`, `initialise`, `migrate`,
`validate`, `reconcile`, `show`, and `remove` for one canonical parent and its
direct sibling children. The v3 tracker has exactly one flat pending queue,
at most one Current child, deterministic queue order, unique lifecycle
membership, and a current-state projection rather than an ever-growing event
log. Parent Markdown is a managed deterministic block; do not improvise or
reconstruct a large parent body in model context.

Use the one shared runtime:

```text
node repo/scripts/toolkit-github-governance-review-reconciler.cjs
```

The runtime is a local contract/parser/transaction library. A real adapter is
not included and must not be invented here. Any adapter supplied by a caller
must return a complete server-authoritative body, revision/ETag metadata when
available, and a complete readback. Incomplete retrieval, missing/duplicate or
ambiguous entries, parse uncertainty, concurrent movement, unrelated-byte
drift, unverified body limits, and incomplete reconciliation fail closed.

## Authority and consent

- A1 remains the sole mutation authority and sole opaque authority-ticket
  authority. N5 requests only typed `github.mutation` authority; it does not
  mint, expose, or create another ticket or finality token.
- A2 remains repository/capability consent and state only. Require exact
  repository identity and enabled `repository.governance` consent; A2 does not
  widen task scope, delegation, GitHub authority, provider/live access, Web
  authority, review mutation, Ready, or merge.
- A3 remains execution/workspace/run/terminal evidence with exactly five
  durable contracts and no finality authority.
- A4 remains independent assurance and Web-finality handoff. Reuse its six
  materiality predicates and exclusion rules; do not add an A4 contract.
- Preserve #295's user-authority model. Do not create a generic independent
  web-controller authority class.

Mutation requires exact repository identity, A2 consent, an accepted read-only
preview, and A1 authorization. Read-only inspection and preview do not mutate.
`remove` is bounded and requires the same authority; it is not a cleanup or
finality action.

## Run-181 contract integrity

The six-root contract is closed:

- B1 binds the exact A2 `repository_id` before A1 or GitHub access; callers
  cannot supply a per-call repository override.
- B2 keeps one flat queue, renumbers pending entries after lifecycle changes,
  rejects represented PR duplicates across every parent section, and requires
  explicit terminal `completed` or `disposed` status. Failed or non-delivery
  PR states never imply completion.
- B3 requires explicit current and expected candidate identity, exact
  represented PR head/tree/base facts, explicit merged and inline-conversation
  booleans, and recomputed finding/Deferred Finding digests.
- B4 uses one module/process owner registry for `repository+parent`; injected
  maps cannot bypass it and every terminal path releases ownership.
- B5 permits terminal compaction only with complete server-authoritative,
  public-safe durable evidence and a deterministic retained digest.
- B6 initialises only unmanaged bodies and migrates only exact v3 or
  `pre-n5-seven-section-v0` bodies with whole-body binding, one write, and
  immediate readback.

## Large-parent transaction

For one bounded update, the transaction is:

1. Fetch the complete raw server body into code/tool state and reject partial
   retrieval.
2. Bind the body digest and any authoritative revision metadata.
3. Parse exactly one v3 managed block and resolve exactly one canonical target.
4. Expose only a bounded projection plus digest/revision metadata to reasoning.
5. Apply the bounded field/lifecycle update mechanically in code.
6. Rebind immediately before the single write and reject concurrent movement.
7. Reconstruct the complete body in code/tool state, write once, and reread.
8. Parse the readback and prove target state plus unrelated prefix/suffix bytes
   and order are preserved.

Body-size thresholds are meaningful only with verified transport provenance. If
the verified limit is exceeded, fail closed unless explicitly authorised safe
terminal compaction can retain Current, Pending, owner detail, and Deferred
Findings while reducing terminal detail. Never split one authoritative queue
across multiple parents because a body is large.

## Review truth model

Inventory pull requests, submitted reviews, and inline conversations before
classifying findings. Require complete server-authoritative pagination; an
empty or incomplete inventory is not green. Keep review inventory, finding
evidence, materiality, disposition, and thread/review mutation as separate
records.

Executors may inspect and recommend. They must not reply to threads, resolve or
reopen conversations, dismiss reviews, manufacture final dispositions, mark
Ready, merge, or claim Web finality. The current programme Web/user controller
owns factual closure, review-thread mutation, final disposition, Web
acceptance, Ready, merge, canonical verification, cleanup, and queue finality.

Materiality uses A4 predicates. A finding is not final merely because an
executor calls it blocking. A truthful disposition needs factual closing
evidence, exact-head/canonical identity, validation, readback, and a
controller-owned reference.

## Deferred Findings

An initial nonblocking finding goes in the parent-managed Deferred Findings
register. It is an index/provenance/revalidation record, not a second queue,
task checkbox, or automatic backlog issue. Keep public-safe evidence sufficient
to revalidate the same component/boundary and preserve the root digest,
source PR/thread/head when available, reason, materiality inputs, and
disposition.

Revalidate at least:

- before work touching the same component or boundary;
- before finality for a PR touching it;
- before a relevant operational/live boundary;
- during the final programme audit sweep.

If no longer material, dispose truthfully. If material, prefer an existing
compatible direct child that is not frozen. Create or promote a direct sibling
execution issue only when material and no suitable child owns it. Never widen a
frozen/current child silently; converge same-root findings rather than creating
review-churn micro-issues.

## Optional capabilities and historical evidence

Codex review is an optional repository-scoped capability, separate from CI, G4,
and Web finality. Its default is enabled; owner-disabled is explicit. Absence,
timeout, or unavailability never becomes green and timers/probe history are not
durable governance by default.

Auto-code readiness is inspection-only. It does not install, schedule, claim a
worker, mutate governance, or grant finality.

PR #310 is closed and unmerged historical evidence. The old caller-token/cache
concern is `NO_LONGER_APPLICABLE` to this current-main N5 runtime only when the
exact evidence says current-main search is complete, the workflow-inventory
surface and caller-token/cache surface are absent, and no historical symbols
are in scope. Do not copy or revive PR #310 or #318 implementation machinery.

## Safety and output

Do not access providers or live systems, create workflows or MCP tools, mutate
review state, publish, mark Ready, merge, change A1-A4, propagate #342, touch
#348, or perform N6-N14 work from this skill. Reject raw secrets, private paths,
private connector data, raw code blobs, credentials, and unredacted runtime
evidence. Secret values must never appear in output.

Return a compact evidence packet with the exact repository binding, intent,
managed-block parse/projection, lifecycle/queue result, transaction/revision
result, review inventory status, finding/DF status, authority boundary,
failures, and exactly one supported next action. A successful N5 result points
only to `READY_FOR_WEB_EXACT_HEAD_VALIDATION`; it does not authorise that next
stage.
