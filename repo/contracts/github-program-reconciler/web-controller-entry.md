# GitHub Programme Web Controller Entry

This is the compact direct-entry surface for a fresh Web Controller. Read only this file first; follow its pinned paths and do not scan the Toolkit repository.

## Managed-repository detection

For the repository under review, first read `.github/ai-agent-toolkit-programme.json`. A valid `toolkit.github-program.controller-bootstrap.v1` identifies the managed repository, canonical Parent, Toolkit version, contract revision, profile, and digest. Then read the pinned contract paths in its `contracts` object. A v5 repository with a missing, malformed, mismatched, unsupported, or unverifiable bootstrap is fail-closed as `PARENT_RECONCILIATION_INCOMPLETE`. A repository with only v4 state is a migration input; an unrecognised repository is unmanaged.

## Exact pinned contract resolution

Require repository `weijunswj/ai-agent-toolkit`, profile `toolkit.github-program.v5`, version `2.12.0`, revision `DL-S2-GITHUB-PROGRAM-SURFACE-RECOVERY-003-v5`, and the bootstrap digest. Resolve the state, managed-event, run-receipt, surface, and migration schemas only from the bootstrap's exact repo-local paths. Resolve the v4 state schema only as migration input. The mutable Toolkit `main` branch is discovery and migration guidance only; it is never runtime programme semantic authority.

## Required inspection

Read the Parent body and canonical v5 envelope, every current Child and its active lane, every current PR and exact candidate, retained managed-event history, and the durable run-receipt chain. Also read native Parent/Child relationships and dependencies, PR association, required checks, review decisions and review threads. Compare repository, Parent, Child, PR, base, head, tree, version, authority, epoch, Lock, gate, fence, and digest bindings before any preview or transition.

## Migration and conformance

Migrate v4 to v5 by preserving historical comments byte-for-byte, retaining valid managed events as history, and keeping unrelated issue/PR bytes, labels, relationships, and project state unchanged. Do not turn arbitrary historical prose into receipts. Render every fixed Parent, Child, and PR heading, including empty sections as `None`; Parent has no visible Next action. Extensions remain additive `extensions.v1` content under `Additional context` and cannot override reserved programme semantics.

Canonical transitions are written only by the deterministic GitHub Programme Reconciler. Executors provide code, candidates, and structured evidence; G4 provides read-only evidence; the Loop Manager persists receipts and orchestrates; Web retains architecture, Lock, material judgement, G4, and finality authority. Persist material terminal evidence before dependent progression. Use durable receipt identity, leases, fences, prior-receipt chaining, readback, duplicate/tamper detection, and zero-delta recovery. A stale authority/candidate or expired/superseded fence remains historical and cannot advance state.

If any required binding, native read, review/check read, migration invariant, receipt, fence, or conformance fact is absent, stale, conflicting, or untrusted, stop with `PARENT_RECONCILIATION_INCOMPLETE`. Do not infer authority from chat, comments alone, or mutable `main`; request one explicit Web decision for the exact unresolved binding.
