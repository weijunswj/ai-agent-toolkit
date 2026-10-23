# GitHub Program Reconciler

Explicit-only skill for programme state on GitHub in a governed repository: private per-child state documents in a private store (compare-and-swap, fence and return IDs), one idempotent reconcile pass (`scripts/programme.cjs`) for native parent/sub-issue links, PR heads, required checks at the head and generated state blocks, the read-only decision-trace audit (`scripts/decision-trace-audit.cjs`) and truthful review records. Dry runs write nothing; `--apply` writes only links, managed blocks and the bound store path. It never closes, deletes or merges.

The skill is directly canonical; its document schemas are in `repo/contracts/programme-state/` in the Toolkit repository.
