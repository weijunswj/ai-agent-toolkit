---
name: controller-bootstrap
description: Use only when explicitly asked to bootstrap or recover the assigned controller for one Toolkit-managed repository after context loss, handover, or an agreed bootstrap event. Do not use for ordinary coding, generic repository setup, or keeping a programme's parent and child issues in step (github-program-reconciler does that).
---

# Controller Bootstrap

Guides an already-authorised repository controller through a bounded re-entry. It does not appoint the controller, create repository authority, grant a worker capability or supply native host permission. The root agent must not infer that it owns the controller role merely because it is the root agent, and must not self-verify root admission.

## Where it applies

Controllers are a Toolkit default: the user can appoint one for any repository or chat, and this skill recovers it. The programme parts below (the CURRENT carrier, the takeover record on the parent issue and other programme records) apply only in a repository whose governance state is ENABLED. Elsewhere, recover from the current branch, PR or brief and the evidence store, and post no GitHub records.

## Entry checks

1. Confirm the explicit task, canonical repository binding, parent, child and release identity, owner, current recoverable state (branch, PR or brief) and assigned controller route from trusted current evidence. A link, packet, prior chat, installation, skill invocation or worker statement is not role or mutation authority.
2. Read the authoritative current state first (there is no handover packet), using the existing CURRENT carrier where applicable, and independently bind source, scope, authority, evidence, pending effects and next action. If a binding is absent, stale, contradictory or unavailable, hold the dependent action and continue independent authorised work. Never reconstruct authority from chronology or memory.
3. Verify repository identity through the existing provider-backed identity boundary. Canonical spelling alone does not prove that a second binding or writer is distinct from an alias, rename or existing assignment; an ambiguous same-repository writer or handover stays read-only pending owner reconciliation.
4. Obtain the accepted Toolkit governance tuple from the trusted authority observation. The task repository remains the task namespace. Do not derive accepted governance from a packet, candidate, local checkout, caller-supplied expected value, or this skill text.

## Exact dependency proof

Resolve the accepted Toolkit authority repository, the release commit on `main`, each exact path and its Git blob through the trusted source adapter, with exactly one binding per source:

- `controller`: `repo/CONTROLLER.md`
- `stack-registry`: `repo/contracts/controller-kernel/stack-registry-v3.json` for explicitly admitted continuous profiles. Bind the exact path; no other registry version is accepted.

Verify the repository, commit, path and blob relationship and the complete returned bytes against both Git blob SHA-1 and content SHA-256; both blobs must match the accepted tuple. Reject missing, duplicate, unknown, truncated, unavailable or conflicting sources, and never substitute an embedded copy, cached prose, another provider or a successful packet parse. Keep source bytes in the authorised retrieval or evidence channel, out of packet prose and logs. In records, link the commit by short SHA and write the full SHA beside it.

If any source or trusted-reader result is unavailable or differs, keep the current binding and history, make no new effect, and return the exact typed failure with a short plain explanation. Do not call a changed policy a product defect without causal evidence.

## Takeover record

Before acting, verify custody and stop the previous writer, then post one takeover record on the parent's CURRENT: the new controller identity, the bound commit and `CONTROLLER.md` blob, evidence that the previous writer stopped, and the next action. Read it back. Then continue the same approved assignment.

## Re-entry and bounded work

- Confirm the approval still covers the exact owner, action, target, resources, effects, recipient, conditions, expiry, revocation state and recorded outcome. An unchanged, unexpired, unrevoked approval remains valid for the same still-pending action when only the turn, worker, chat or transport changes; seek fresh approval or host confirmation only for a changed or new action, a revoked or expired approval, or work the recorded outcome does not cover. Assignment, custody, capability, and host-native permission remain separate.
- Initial adoption reads the complete direction once. Unchanged continuation loads the current state, the small operating entry and the relevant role and authority sections; bind exact source identities and refresh only applicable changed or conflicting instructions. Do not reread the full Controller or programme history before each ordinary effect. Missing required provenance holds only its dependent effect.
- Bind one repository, owner, RUN/Lock, candidate, base, head and tree, scoped path and effect ceiling, budget, unresolved outcome and return boundary. Independent repositories stay independent bindings; a result or returned link cannot switch a binding.
- Use the existing authority-packet and execution-loop paths for admission and revalidation. Packet syntax, durable storage, Web acceptance, CURRENT projection or a fresh-process readback alone is not an admission token.
- Dispatch only what the accepted CURRENT and trusted admission permit, and revalidate immediately before each effect. An unknown dispatch outcome is not permission to retry; a late result belongs to its original execution and is reconciled before any replacement.
- On context loss, recover from CURRENT and the exact bound evidence, re-establish the same RUN/Lock and unresolved outcomes, then continue the same approved builder assignment and its in-scope corrections; no new issue or mini-gate is needed because context changed. Planned G1 segment completion checkpoints and continues in the same session; a fresh executor is required only at the governed block's fresh-context triggers, after verified custody stops the old writer. Keep the UAT impact disposition, fresh-context correction rechecks for the same selected reviewers, and the local and stored retention rules. If CURRENT or the handover is ambiguous, stay read-only and request the owner or controller decision.
- For every controller decision, record the controller actor and stable provider/host actor identifier plus a distinguishable decision prefix, and the human owner separately; never use the owner's identity for the controller actor. If either cannot be established, return HOLD.
- Compare each feedback item with the implemented source and tests and with the planned child, seed, shared, and deferred contracts. Record it as implemented and tested, missing, explicitly deferred, shared or seed-owned, or contradictory. Keep missing required behaviour unresolved and never import deferred work or close a contradiction without evidence.
- Optional timers may only refresh bounded observations under a separately enabled, qualified scheduler. They never launch work, change policy, grant authority, reset budgets or replace transition checks.

## Controller record updates

Updating a shared Controller or other governed record is outside read-only bootstrap and needs its own approval and supported native write permission. With that authority:

1. Independently fetch the complete current object, including its exact body, stable identity, revision/ETag and permission evidence.
2. Derive the smallest intended edit from that fresh body and verify every unrelated section stays byte-for-byte unchanged.
3. Check that the revision still matches and use the provider's conditional-write mechanism; without conditional writes or permission evidence, stop without writing.
4. Write only the approved change, then fetch the complete object again and verify the edit, the revision transition and the preserved content.
5. If the write response is uncertain, read the object and reconcile the actual state before any other write. Never retry an uncertain mutation from cached state.

## Roles, delegation and routes

Use the current registry family: the strong lead shared by G0 and G1, each stack's own helper bindings, and fresh G2 reviewers without helpers. G0 MUST default-delegate suitable separable evidence gathering; G1 MUST default-delegate suitable independent implementation/validation. Record substantial direct-work exceptions briefly; no nested delegation, helper quota or extra permission for already-authorised work. Service tier is controller/launcher metadata: the latest owner choice is Standard for future launches, never a semantic worker/helper admission condition.

Model and effort follow launch ownership. A human's direct choice for an agent they open themselves (including a G2 chat) is advisory, not a blocker, and is recorded as the actual route, never labelled the recommended one. Every automation-launched G0/G1/G2 worker or successor and every G0/G1 helper gets the exact pinned-stack route for its role and member, without fallback or weaker effort, with model and effort pinned at launch. Route proof is the launched session's own metadata (for example `get_session(self)`) read back before consequential work; an inherited, missing or mismatched effort refuses to start. A root label is not a human override, and no model lock goes into a human-run entrypoint. Native permissions, independence, reviewer obligations and delegation limits still apply.

## Host qualification

Use [qualification](references/qualification.md) to state exactly what has been proven on the active host. Discovery, installed bytes, metadata, labels, screenshots and self-report do not prove loaded invocation, route and effort, native permission, result delivery or context-loss recovery. Unsupported host and version combinations remain unqualified. Installation and removal are separate owner-authorised actions outside a read-only bootstrap.

## Stop conditions

Return HOLD without side effects for a missing role assignment, governance applicability, exact sources, repository identity, CURRENT, required owner approval, supported native permission or complete outcome reconciliation. Never publish private device names, filesystem paths, environment values or local runtime details.
