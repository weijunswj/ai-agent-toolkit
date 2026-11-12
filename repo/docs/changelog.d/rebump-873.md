Title: self-checking evidence store command

### Added

- **`toolkit store`:** `repo/scripts/toolkit-store.cjs` does every evidence store step on a computer (`status`, `sync`, `save`, `move`, `merge-branch`, `delete-merged-branch`) and checks the store itself first: the merged binding's store and branch, a checkout whose fetch and push addresses are that store and whose own config holds no push, rewrite or program setting, and a private, writable store on GitHub. `save` stages only the named paths under the binding's store path, `archives/` or `evidence/`, secret-scans exactly what it stages (refusing a binary or non-UTF-8 file it cannot read), commits, pushes the bound branch with a plain push and reads it back on GitHub. Ancestry is read from real commits only (no grafts, replace refs or commit-graph), a merged branch's whole history is scanned, and "already merged" before a branch delete is GitHub's answer, not the checkout's. It never force-pushes, rebases, deletes a file or pushes another branch, and deletes a store branch only when it is already merged.

### Changed

- **Permission blocks:** the exact store push line and its ask lines are replaced by one store command line in the computer block. On Codex it is an allow rule and no store prompt rule is printed, so store steps stop asking there too. `toolkit permissions` no longer takes `--store`.
- **Merge authority:** changes to the store command wait for a typed merge, like the permission and cleanup scripts.
