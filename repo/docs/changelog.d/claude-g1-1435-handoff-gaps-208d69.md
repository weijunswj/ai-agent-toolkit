Title: handoff snapshot review fixes

### Added

- `toolkit-store.cjs handoff --check` names `unsure=<files>`: files this copy holds differently from a snapshot row written before rows carried a time, whose order nobody knows (this copy may hold a save the snapshot missed, or be older). It says `STALE` for them instead of `CURRENT`. `handoff --reseed`, run only from the newest copy, takes this copy for those files; hook-started runs still never decide that order themselves. A row whose time came from its snapshot is marked `modified_from: "snapshot"`, so later checks still know.

### Fixed

- The handoff hook's first check in a session only notes what the session holds and never starts a refresh; the next check, at least a minute later, decides. A scheduled task whose first tool call comes before the one that turns the hook off no longer starts one refresh.
- A memory folder that is there but empty (a re-sync that cleared it, an empty mount point) counts as unreachable, so a hook-started run keeps its rows instead of dropping them all.
- A hook-started run judges a memory row by the memory folder it names now, so rows first written under an older folder path are kept when the folder cannot be reached.
