### Changed

- **Handoff snapshot mirrors the memory folder, deletes included:** a memory file deleted on this computer now leaves the controller handoff snapshot (`toolkit-store.cjs handoff`): its row becomes a removed row with the time it was removed, and its copy leaves the store's current files (Git history keeps it; the snapshot README says how to get it back). A file is removed only when this computer's last saved run (its folder record, kept in the Toolkit user-state folder) or the session's baseline held exactly the snapshot's content, so a stale, partial or other computer's copy never deletes a newer save. A removed file comes back only from different content saved more than 5 minutes after the removal, so a session still holding the old copy no longer brings it back. A clock behind the snapshot removes nothing (`clock=behind`).
- **A computer changes only memory it has seen:** a run updates a stored memory file only when this computer's last saved run or this session held exactly the stored content. Otherwise the stored copy stays and the run and `--check` name it as `diverged=<files>`, so a second computer that has not synced can add new memory files but never replace or remove one. A manual `--reseed` run takes this copy for the diverged files; the after-tool hook never does.
- **Store deletions:** the store command still refuses every deletion, except the handoff snapshot's own removals of memory files its manifest lists as removed in the same commit.
- **Manifest version 2:** the snapshot manifest is `toolkit.handoff-snapshot.v2` (adds the removed rows). This copy reads version 1 and writes version 2 on the next change; an older Toolkit copy reads version 2 as no snapshot.

### Added

- **`handoff --confirm-removals`:** a run that would remove more than max(10, a fifth of the memory rows) holds them and says `held_removals=<n>`; a manual run with this flag applies them.
- **`handoff --memory <folder> --replace-memory`:** a manual run that makes the named folder the whole memory set: every memory row it lacks is removed and its copy of every other memory file wins.
- **`handoff --check` fields:** `removed=`, `held_removals=`, `clock=behind`, `removed_here=` (removed files this copy holds with different content) and `diverged=` (memory files this computer never held at the stored content).
