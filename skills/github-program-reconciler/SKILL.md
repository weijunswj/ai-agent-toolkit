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

The runtime is a deterministic local contract and transaction library. It ships no live GitHub provider client. Fixtures and host adapters inject authoritative current state and exact mutations. New programme work uses `toolkit.github-program.state.v5` under design lock `DL-S2-GITHUB-PROGRAM-SURFACE-RECOVERY-003`; v4 is frozen migration input and its semantics are not silently changed. v5 replaces the singleton cursor/candidate with explicit concurrency authority and ordered active lanes, and separates canonical managed events from durable run receipts.

Inspection and PREVIEW never mutate. v5 migration and reconciliation persist preview identity through a durable store; an in-process map is not replay authority. APPLY requires a trusted host-injected authority verifier; a caller-authored `granted` flag is never authority. The verified grant binds the accepted preview type/ID, repository, Parent, source revision/snapshot/body/state digests, target canonical/projection digests, candidate/authority/lane/Lock/gate/fence bindings, managed-event and receipt identity, operation digest and every stable operation ID. READBACK_VERIFY rereads every affected projection, label definition, managed event, receipt and native relationship inventory and proves unrelated state was preserved. Stale, conflicting, partial, expired-fence, or unverifiable work fails with `PARENT_RECONCILIATION_INCOMPLETE`.

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
- A first-party scope grant independently binds the closed `CHILD_MEMBERSHIP`, `DEPENDENCY_EDGES`, and `PR_ASSOCIATION` operation classes plus bounded adapter/authority/revision/digest/API provenance. Relationship inspection must echo that exact capability identity. Every changed class is required before the single composite relationship transaction can be planned.

## PR association safety

Maintain one deterministic `ACTIVE / ACCEPTED / RETIRED` registry. A Development or closing-keyword association can close an issue when its PR merges into the default branch, so only a terminal PR that genuinely completes the child may receive a closing association. Intermediate PRs use safe cross-reference or timeline evidence.

## Materialised views

- The Parent managed body contains the only canonical semantic state plus its digest envelope.
- Parent prose is a compact derived dashboard with current child, child graph, holds, and next action.
- Child prose is a derived operating contract with lifecycle, dependencies, current epoch/gate, epoch/Lock and PR-registry tables, holds, boundaries, and next action.
- PR prose is a derived lane with registry lifecycle, role, completion safety, epoch/Lock, exact candidate, changed surfaces, and finality.
- Child and PR hidden envelopes bind their projection digest, extension digest, and the Parent canonical digest.

The v5 portable contract is `repo/contracts/github-program-reconciler/programme-surface-contract-v5.json`; the v4 contract remains the frozen compatibility contract. Typed, target-bound `toolkit.github-program.extensions.v1` records may add information, evidence, policy, domain health, tables, or provenance and always render under `Additional context`. Every rendered title, text, summary, reference, domain, status, table heading, and normalized table cell is checked before rendering. Extensions never feed portable derivation and may not encode authoritative lifecycle, gate, epoch, candidate, PR state, Lock, finality, Ready/merge/acceptance, holds, dependencies, remaining work, or next action declarations under aliases. They also may not contain any reserved programme marker or envelope.

Before any operation list is constructed, every rendered Parent, Child, and PR managed body must parse as its exact target, contain exactly one applicable marker pair and envelope, bind the target canonical digest, equal the generated managed bytes, and reproduce byte-for-byte from the parsed canonical truth.

Any authorised transition that changes a represented current field must update the body projection in the same transaction. Comment-only current-state changes are incomplete. READBACK_VERIFY validates the whole issue or PR body, not only the managed block, and rejects structurally anchored legacy `CURRENT`, `PLANNED`, `BLOCKED BY`, current-gate, or current-candidate sections that compete with the canonical projection. Clearly labelled historical evidence remains allowed.

## Managed chronology

Only typed managed events are machine authority. Valid v1/v2 events remain bounded historical inventory. New v3 `canonical_initialisation`, `canonical_transition`, `migration`, and `recovery_transition` events bind repository/Parent/entity identity, source and target state digests, authority, candidate, lane, epoch, gate, Lock, fence, receipt, and prior-event identity. Separate v1 run receipts cover `RUN_STARTED`, executor/G4 terminals, interruption, lease expiry, hosted checks, and transition previews; terminal results are durable before dependent progression. IDs derive from structured facts, never rendered Markdown. Stable IDs, duplicate/tamper/conflict detection, late-fence handling, and event-bearing zero-delta replay are mandatory. Similar-looking arbitrary prose is not authority.

## Labels and conformance

Every child has exactly one managed lifecycle label: `completed`, `current`, `queued`, or evidence-backed `blocked`. Preserve unrelated labels, reconcile the four label definitions, remove stale mutually exclusive managed labels, fail closed on multiple current children, and prefer native closure.

Classify repositories as `UNMANAGED`, `LEGACY_MANAGED`, `CURRENT_MANAGED`, or `DRIFTED_MANAGED`. Initialisation or migration is inspect -> preview -> explicit authority -> write -> readback -> zero-delta rerun. A stale projection may be transformed only under `toolkit.github-program.stale-projection-migration.v2`: a trusted Web-adjudication verifier must bind repository, entity, whole-body digest, exact recognised spans and their digests, intended result digest, and operation. The grammar permits only structurally recognised programme headings to become clearly historical; arbitrary owner prose can never be selected by caller arithmetic. Preserve every unrelated byte. Recognised legacy parsing exists only for bounded migration; it is not a second truth or permanent compatibility runtime.

## Review truth and finality

Preserve the accepted server-authoritative review inventory, finding evidence, Deferred Findings, A1-A4, and repository-consent boundaries. Empty, stale, partial, caller-invented, or unverifiable review evidence is not green. Executors may inspect and recommend but must not reply to or resolve review threads, dismiss reviews, mark Ready, merge, manufacture finality, or choose the next current child autonomously.

Before PREVIEW, obtain a branded `toolkit.github-program.scope-grant.v1` from a first-party adapter that was not given desired Parent/Child/PR scope. Exact repository, Parent, ordered children, dependencies, associated PRs, allowed relationship operation classes, and capability provenance are digest-bound before relationship or PR inspection. Candidate identity stores only PR, branch, base ref, base SHA, head, tree, version, and epoch ID. Child, Lock, role, completes-child, registry disposition, and live lifecycle derive from canonical containment, the unique ACTIVE registry/epoch, and trusted PR inspection. GitHub base ref and base SHA are separate facts and both must match.

`ACTIVE` normally requires an open Draft PR. Open Ready is legal only for a terminal completing PR after every required epoch is accepted, no blocking hold remains, and retained Web finality authority exists. `ACCEPTED` requires trusted merged evidence; `RETIRED` requires trusted closed-unmerged retirement evidence. Only the terminal completing PR may receive a closing association.

Canonical state is limited to 32 KiB UTF-8, each managed body to 56 KiB, all projections to 512 KiB, and each run receipt to 16 KiB. Budget failure occurs before planning or apply. READBACK_VERIFY reparses the Parent canonical state and every projection envelope, verifies labels, managed-event and receipt inventories, trusted PR facts, native relationships, and requires an immediate `ZERO_DELTA / ZERO MUTATION` rerun.

Fresh Web controllers enter through `.github/ai-agent-toolkit-programme.json` and resolve the exact pinned v5 schemas, version, revision, digest, Parent, and profile. If the repo-local bootstrap is absent, the stable generic entry is [`web-controller-entry.md`](../../repo/contracts/github-program-reconciler/web-controller-entry.md); it is intentionally compact and does not make mutable Toolkit `main` runtime authority.

Return a compact packet with repository/parent identity, conformance, predecessor coverage, preview/current bindings, exact delta, authority boundary, apply/readback result, zero-delta rerun result, failures, and exactly one controller-owned next action.
