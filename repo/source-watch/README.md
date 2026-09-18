# Source Watch

Source-watch is deterministic review-notification-only. It compares active third-party `SOURCE-LOCK.json` identities with human-advanced reviewed-through cursors and may open or refresh one stable notification PR. It must not copy upstream files, update source locks or cursors, execute upstream code, delete Toolkit components, auto-merge, or push to `main`.

`review-state.json` stores only human-advanced reviewed-through cursors. A cursor records the exact upstream state that was reviewed and dispositioned; it never adopts a source pin or records the latest observation. The detector matches the source-lock identity first, then uses the adopted `source_commit` when no cursor exists. Retired advisory, semantic-review, host-drift, and cadence ownership is not recreated by this workflow.

## Active review lane

| Input | Review trigger | Output |
| --- | --- | --- |
| `repo/source-watch/provenance/**/SOURCE-LOCK.json` plus `review-state.json` | Latest upstream commit differs from the identity-matching reviewed-through cursor, or from the adopted `source_commit` when no cursor exists. | `repo/source-watch/reviews/active-third-party-updates.md` notification PR. |

The notification contains source identity, adopted and reviewed-through revisions, latest observed revision, tracked files, attribution requirements, and the exact manual-review checklist. It does not contain secret values or propose automatic adoption.
