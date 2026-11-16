### Changed

- **Retired `schedule_folder` leaves bindings:** every binding writer now drops this retired programme-file key, which nothing reads. That covers a governance turn-on or refresh proposal, a task auto-merge or merge-train switch pull request, a parallel CI shards answer and the instruction-copies cleanup. A switch, shards or cleanup change keeps the file's own layout, so its diff shows one extra removed line, and its pull request text or preview names it. A binding that still carries the key stays valid. This repository's own programme file no longer carries it.
