Title: Marked notes move off large programme pages

### Added

- **Marked notes:** on a programme parent page, old hand-written notes under one line that reads exactly `## Archive` now move, byte for byte, into linked comments on a complete pass. The whole page is saved to the private store and read back first, each comment is read back exactly before one guarded page write removes the notes, and AGENT CONTEXT links every part. Note comments are never edited, reused for other text or deleted.
- **New finding:** `ARCHIVE_SECTION_UNSAFE` reports, with one fixed reason and no page text, why marked notes stayed on the page. Any doubt about where the marked area starts or ends moves nothing, and the redraw carries on. The reader accepts only a written subset of Markdown up to the end of the marked area: blank lines, heading lines, code fences at the start of a line, `<details>` folds (attributes without quote marks) and comments on their own lines at the start of a line, and text lines with no HTML-like text and no level one or two heading or code fence behind indentation, a quote, a list marker or a footnote. Any other line, a Unicode space other than a plain space or tab, a lone carriage return or a leading byte-order mark moves nothing. Notes that use inline HTML, raw HTML blocks or indented code fences stay on the page with a finding; rewrite the line or move it outside the marked area.
- **Stopped passes:** a pass that stops for time finishes its redraw but moves no notes; the next complete pass moves them.

### Changed

- **Archive registry:** `page_archive` now also records note parts (with the saved page copy they came from). A note comment that later changes or disappears keeps its link and raises `ARCHIVE_COMMENT_UNTRUSTED` once, naming the saved page copy that holds the notes; later passes stay quiet and the owner's answer to the finding stands. Putting the same notes back under `## Archive` posts a fresh comment for them and leaves the damaged one as found. Older Toolkit versions refuse the new entries and the new finding field; update Toolkit on every computer that runs the sweep before marking notes.
- **AGENT CONTEXT:** the fixed line now says that only notes under one `## Archive` heading move.
