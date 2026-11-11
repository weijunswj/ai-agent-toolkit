Title: One layout for task pages and task PRs

### Added

- Open task pages follow one fixed order: PATH, STATUS and COMMENT TRACE, then PROBLEM, FIX, IF WE SKIP, DONE WHEN and NOT IN SCOPE, then More with every other hand-written word in its original order. Older label lines and headings become the matching capital sections; the words under them do not change.
- A copy of a task page is saved to the private state store and read back before any write that moves its hand-written text. Without the copy the page is not written.
- Every open or draft PR that names a task gets PATH and STATUS at the top, with the gate, review at the head, UAT and release of each task it names. The PR description stays as written, and merged or closed PRs are never edited.
- A managed block shown as an example inside a code block, quote, list item or indented code is hand-written text on every page: it is never updated, moved or cut.
- The plan says when a page's text will move ("Lay out #<n>'s page in the fixed order"), and the result names the saved copy.
- The task status block lists every PR found for the task, open first.
- A page that cannot be laid out safely keeps its text in place, still gets fresh blocks, and raises the new `PAGE_LAYOUT_HELD` finding with the reason. A pass re-lays at most ten pages.
- The new `TASK_IDLE` finding flags a task shown in progress with no open PR, no live gate assignment, no holder and no change for six hours.

### Changed

- The Programme Graph PR column shows one PR per row, the most recently opened one, with no count of other PRs.
- The generated blocks on task pages carry capital headings, matching the programme page.
