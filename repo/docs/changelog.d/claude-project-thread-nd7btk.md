Title: Task runs come first

### Added

- **Scheduled task runs outrank other work:** the Projects skill now says a task run outranks all in-flight work except answering the owner. The coordinator handles it in the turn it arrives, before relaying thread updates or merge work, and acts on every step its report or its task's own checklist names.
- **No `.done` after a partial pass:** the coordinator never writes `.done` while any step is unfinished. A step that truly cannot finish leaves `.done` missing, goes on the promise list with its run time, and is finished first on the next turn.

### Changed

- **Projects skill trim:** the gate route line drops its long example, since the format and the per-gate example already show it, keeping the skill under its byte cap.
