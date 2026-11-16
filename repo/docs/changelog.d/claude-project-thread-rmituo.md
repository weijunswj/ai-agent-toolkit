Title: store save recovers from a failed push

### Changed

- `toolkit store` save, move and merge-branch no longer strand the store checkout after a failed push. A push is tried up to 4 times with waits of 2, 4 and 8 seconds; before each retry the store is read first, so a push that landed is never sent twice, and a store that moved is merged with a merge commit. After the last try the commit stays in the checkout, and running the same save again checks it and pushes it.
- Commits the store lacks, whether kept by a failed push, made by hand or made by a race merge, are checked again right before every push: every blob and every commit message is secret-scanned, and each change may only add, change or exactly rename plain files inside the store folders. A commit that fails is named and never pushed.
- A race merge that conflicts is cancelled and made again keeping both versions: the store's copy stays in place and ours is saved under `evidence/store-conflicts/`. No step leaves a half-done merge, and `sync` cancels one an older run left, keeping every commit.
- The `--message` text is secret-scanned before anything is committed.
- No store refusal points at a raw push, a reset or a hand merge any more.
