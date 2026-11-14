Title: merge trains follow governance

### Changed

- **Merge trains follow governance:** trains run only where governance is enabled and the merged binding's new `task_prs.merge_train` switch is not `off`; no key means on. Elsewhere `toolkit-merge-train.cjs build`, `catchup` and `land` refuse and each ready pull request merges alone, and a train already in flight cannot land. `verify`, `body`, `split` and `eject` still check or unwind a train.
- **Trains land on task auto-merge:** `land` now names a route. `auto` means the repository's task auto-merge switch is on, the train passes the auto-merge scope and `UAT:` check at its head and no member is RISKY, so it merges after the effects notice with no merge card. `owner` lists its reasons and waits for the owner's card.
- **Binding:** `task_prs` may hold `merge_train` (`on` or `off`) beside `auto_merge`. Toolkit copies older than this release show governance ERROR on a binding that sets it.
- **Stale reads ask for a fresh read:** when this computer's read of the binding is stale or missing, the train commands say to read it again online (`toolkit-governance.cjs status`) and retry, instead of telling the agent to merge each pull request alone.
- **Merge-authority list:** `toolkit-merge-train.cjs` joins the files whose changes wait for the owner's typed merge, because its `land` step names the route that merges without a card.
