### Added

- Programme reconciler: `programme.cjs handover --issue <n>` writes one generated handover file per task, and one for the parent, to the private evidence store at `handover/issue-<n>.md`, so a fresh session can resume from the issue number alone. It holds the path, status, next action, open PRs, holds and findings, recent decisions, the plan and evidence links; gates run it at each gate end, and any session may write it.
- Programme reconciler: drift findings. A full pass reports an open task page with no generated blocks (`BLOCKS_MISSING`) or an older state than the stored one (`BLOCK_BEHIND`), an open task PR without a readable PATH block (`PR_NAV_MISSING`), a closed issue an open task PR names outside the programme (`CHILD_NOT_NATIVE`) and a next action set before its task's latest merge or close (`NEXT_ACTION_STALE`). Each resolves by itself once its condition is gone.

### Changed

- Programme reconciler: one page-copy format. Every saved copy of a programme page is the page's exact text at `page-copies/issue-<n>/<sha256>.md` in the private store, for marked notes and re-laid task pages alike, after the private-store check and the secret screen. Older JSON copies still read. `ARCHIVE_COMMENT_UNTRUSTED` names a saved copy only when that copy is in the store.
- Rules: the governed rules say the parent page shows queue and status while each child and PR shows SHA, release, gate, review and UAT, that gate ends run `programme.cjs handover`, and how a related task is reused. The global rules give the PR body the CHANGE shape (WHY, WHAT, CHECKED, `UAT:`, `Closes`/`Refs`). The decision-trace and takeover playbooks and the bootstrap skill read the handover file.
