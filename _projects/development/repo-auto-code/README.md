# Repo-Scoped Default-Off Closure-Lease Auto-code Protocol

First-party source-only design for issue #329 and PR #333. Controlling Design Lock chain: `DL-329-AUTO-CODE-005` -> `DL-329-AUTO-CODE-005-A1` -> `DL-329-AUTO-CODE-005-A2` -> `DL-329-AUTO-CODE-005-A3` -> `DL-329-AUTO-CODE-005-A4` -> `DL-329-AUTO-CODE-005-A5` -> `DL-329-AUTO-CODE-005-A6` -> `DL-329-AUTO-CODE-005-A6-C2` -> `DL-329-AUTO-CODE-005-A6-C3` -> `DL-329-AUTO-CODE-005-A6-C4` -> `DL-329-AUTO-CODE-005-A6-C5` -> `DL-329-AUTO-CODE-005-A6-C6` -> `DL-329-AUTO-CODE-005-A6-C7` -> `DL-329-AUTO-CODE-005-A6-C8` -> `DL-329-AUTO-CODE-005-A6-C10` -> `DL-329-AUTO-CODE-005-A6-C11`.

Final fixture universe: 112 total, 17 accepted, and 95 rejected. The module is uninstalled, unscheduled, inactive, and has no runtime activation or automatic next-task pickup.

Roles are explicitly capability-bound; missing activation returns CLOSURE_LEASE_NOT_ACTIVATED. C7 is conjunctive and Web-only; exceptional assurance is grant-bound. C8 adds deterministic snapshots, sealed leases, machine admission, exact manifests, typed receipts, and sensitivity handling. C11 adds default-deny delegation and an explicitly granted exclusive Auto-code manager/worker lifecycle without autonomous spawning.

Full source design and raw-evidence fixtures: [_main/](_main/). Focused validation: node --test repo/tests/repo-auto-code-design.test.cjs
