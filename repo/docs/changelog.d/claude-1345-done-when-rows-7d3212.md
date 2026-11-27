### Added

- **Every open task shows its DONE WHEN progress.** The programme sweep raises `DONE_WHEN_ROWS_MISSING` for an open task page with no checkbox row under DONE WHEN (no DONE WHEN, plain or numbered rows, or none), so the graph's Progress count can show for every task; it resolves once a checkbox row is there and is never disposed.
- **`programme.cjs done-when-rows`.** A dry run any session may make lists the open task pages whose DONE WHEN rows are plain or numbered list items, each row before and after, and the pages with no rows to convert; `--apply --controller` (the parent's holder) turns those rows into unticked `- [ ]` checkboxes, keeping their text. It never adds or ticks a row, leaves a page that already has checkbox rows, the `**Not in scope:**` list, code, comments and generated blocks alone, saves each page to the private store first and reads it back after.
- **Setup and refresh governance offer the backfill.** The governance summary shows a Task DONE WHEN rows row with the dry run's result, and the owner's words `convert done-when rows` run the backfill; once nothing is left to convert, that computer stops reading for the repository.

### Changed

- **Task filing.** The reconciler skill says to write each DONE WHEN row as an unticked `- [ ]` checkbox.
