Title: controller handoff snapshot refreshes itself

### Added

- **Controller handoff snapshot saves itself:** `toolkit-store.cjs handoff` copies the controller's memory folder, saved instructions and named working files into `evidence/handoff/<owner>/<repo>/` in the evidence store, after a secret scan of every source, and saves only when a file's content changed (`HANDOFF UNCHANGED` sends nothing). Its `manifest.json` lists each file's sha256 and the stamp, and remembers the sources, so later runs need only the store and repository. A source not reachable on this computer keeps its last copy. With governance off, `--out <folder>` writes the same snapshot anywhere and sends nothing.
- **Refresh without a scheduled task:** in Claude Code, an after-tool hook starts one background `handoff` run after a successful store save (the gate-end archive) or a write to a remembered source, at most once per 10 minutes. It never blocks and does nothing until a handoff run has recorded its store. Codex and other harnesses use the gate-end step on the controller's evidence page.
- **Stale snapshot check at session start:** the controller health check has a `handoff` row (`--handoff <folder>` with `--checkout`): a read-only compare that flags a changed or missing snapshot with its age. The Projects hourly and daily runs skip it.

### Changed

- **Takeover reads the snapshot per repository:** the takeover playbook reads `evidence/handoff/<owner>/<repo>/` and reports the stamp its `manifest.json` records, the same on every store backend.
