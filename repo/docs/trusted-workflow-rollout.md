# Trusted workflow staged rollout

Stage A is the only state implemented by PR #310. Both privileged workflows are read-only and emit proposals only. Their committed policy values are authoritative:

- Auto-sync: `rollout_stage: "A"`, `writeback_enabled: false`, `general_enabled: false`.
- Source-watch: `rollout_stage: "A"`, `publication_mode: "dry-run"`, `scheduled_write_enabled: false`, `manual_canary_enabled: false`, `general_publication_enabled: false`.

After Stage A merges, a controller may run one canonical-main dry-run rehearsal against one bounded PR. Evidence must bind the workflow, run and job IDs; canonical-main and target-head SHAs; helper and closure-manifest digests; preflight order; generated proposal; rejected write scope; and zero commit/push attempts.

Stage B1 requires a separate full child issue and reviewed activation PR. It admits one exact canary PR number and head SHA, rejects every other PR before PR checkout, retains global concurrency, and permits at most one non-force fast-forward generated commit. Canonical `main` remains canary-restricted after the proof. Any assertion failure leaves general writeback impossible; the controller may disable the canary path through a bounded rollback PR.

Stage B2 is a second reviewed PR. Only it may remove the exact canary restriction and enable general eligible-PR writeback. Stage B1 evidence is not Stage B2 approval.

Source-watch activation is independently staged. Its activation issue and PR may enable one manual canary only after the canonical-main dry-run passes. General scheduled publication requires another reviewed transition. Publication is append-only: create a digest branch from current `main` when absent; otherwise advance the exact old tip, re-read it immediately before a non-force push, retry after movement, and never reset, rebase, force, or force-with-lease. Unsafe history is superseded by one digest-suffixed branch and one deduplicated notification PR.
