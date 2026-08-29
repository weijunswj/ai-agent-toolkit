# GitHub Programme Web Controller Entry

This is the compact generic direct-entry surface for a fresh Web Controller.
Read it first, then inspect only the target repository's bootstrap and the
pinned contract it names. Do not scan the Toolkit repository.

## Detect the managed repository

In the target repository, read .github/ai-agent-toolkit-programme.json.
Accept it only when schema is
toolkit.github-program.controller-bootstrap.v1, profile is
github-managed-programme, the target repository and parent_issue match the
repository under review, and the state/surface schemas, package version,
conformance, and compatibility fields are supported. A v5 repository with a
missing, malformed, stale, unsupported, or mismatched bootstrap is fail-closed
as PARENT_RECONCILIATION_INCOMPLETE.

## Resolve the exact pinned contract

Resolve toolkit_contract.repository, toolkit_contract.revision, and
toolkit_contract.path from the bootstrap.
Fetch that exact immutable revision and path, then verify its SHA-256 equals
toolkit_contract.sha256 before using any programme semantics. Follow the pinned
contract for state, surface, events, receipts, migration, projection, and
recovery. The target repository is the programme owner; the
toolkit_contract.repository is only the pinned contract source.

## Required reads and conformance

Read the Parent, every current Child and its epoch/Lock/gate, every current PR
and exact candidate, managed-event history, and the durable run-receipt
inventory. Also read native Parent/Child membership and dependencies, PR
association, required checks, review decisions, and review threads. Verify
repository, Parent, Child, PR, base, head, tree, version, authority, epoch,
Lock, gate, candidate, fence, receipt, and digest bindings.

For v4 or legacy state, use the pinned migration rules: preserve historical
comment bytes, retain valid managed events as history, preserve unrelated
issue/PR bytes and native state, and do not infer receipts from prose. A
bootstrap candidate is repository code delivered through the normal PR path;
it is conformance evidence, not a programme Apply operation. Missing, stale,
conflicting, or untrusted facts stop the run with
PARENT_RECONCILIATION_INCOMPLETE.

When the bootstrap is absent, classify legacy or unmanaged state using only
the target repository and this entry surface as discovery and migration guidance only.
Do not infer runtime authority from mutable Toolkit main: it is never
programme semantic authority. Web retains architecture, Lock, material
judgement, G4, and finality authority; the deterministic reconciler alone
writes canonical programme state.
