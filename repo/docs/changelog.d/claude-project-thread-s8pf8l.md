Title: pages stay drawn and within budget

### Fixed

- **Parent page never redrawn on a busy programme:** the sweep refused to write the parent whenever any comment landed on it during the pass, because a comment moves the issue's update time. A busy parent gets decision and merge records every few minutes, so pass after pass held with `BODY_MOVED` and the page kept an old layout. The page is now held only when its body itself changed; the next pass picks up anything a new comment changes.
- **`BLOCK_BEHIND` false alarms:** a task page drawn by an older Toolkit at the stored revision was reported as showing an older state. The check now compares the page's drawn state revision with the stored one, and only for pages in that pass.
- **`BODY_OVER_BUDGET` next step:** it now names a step that clears it on each kind of page: a `mark-archive` holder order on the parent or a task page, and the builder trimming the description to the CHANGE shape on a PR page.

### Added

- **Marked notes on task pages:** old notes under one `## Archive` line on an open task page leave it when the page is laid out. The whole page is saved to the private store first, and one `Archived notes: [page copy](...)` line links that copy.
- **`mark-archive` holder order write:** the only write to a page's hand-written text, so nobody edits a page by hand. It puts one `## Archive` line above a named line, or removes named link lines nothing on the page uses, on the parent or an open task page. It saves a copy of the page first, checks the result with the reader that will move the notes, and refuses on any change.
- **Handover link:** the parent's AGENT CONTEXT line links its handover file in the private store.
