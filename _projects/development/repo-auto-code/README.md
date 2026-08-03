# Repo-Scoped Default-Off Closure-Lease Auto-code Protocol

First-party source-only design for issue #329 and PR #333. Controlling authority: DL-329-AUTO-CODE-005 with A1, A2, and A3.

Final fixture universe: 112 total, 17 accepted, and 95 rejected. The module is uninstalled, unscheduled, inactive, and has no runtime activation or automatic next-task pickup.

The supported roles are web governance controller, closure manager, implementation/amendment worker, final pre-G4 reviewer, authoritative technical G4 reviewer, independent assurance auditor, and evaluation-staging lane. Capability failures return UNSUPPORTED_DELEGATION; missing activation returns CLOSURE_LEASE_NOT_ACTIVATED.

Full source design and raw-evidence fixtures: [_main/](_main/). Focused validation: node --test repo/tests/repo-auto-code-design.test.cjs
