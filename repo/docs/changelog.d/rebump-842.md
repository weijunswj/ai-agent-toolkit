Title: marked notes move off large programme pages

### Added

- **Marked notes:** on a programme parent page, old hand-written notes under one line that reads exactly `## Archive` now move, byte for byte, into linked comments on a complete pass. The whole page is saved to the private store and read back first, each comment is read back exactly before one guarded page write removes the notes, and AGENT CONTEXT links every part. Note comments are never edited, reused for other text or deleted.
- **New finding:** `ARCHIVE_SECTION_UNSAFE` reports, with one fixed reason and no page text, why marked notes stayed on the page. Any doubt about where the marked area starts or ends moves nothing, and the redraw carries on.

### Changed

- **Archive registry:** `page_archive` now also records note parts (with the saved page copy they came from), and a note comment that later changes or disappears keeps its link and raises `ARCHIVE_COMMENT_UNTRUSTED` instead of being posted again. Older Toolkit versions refuse the new entries; update Toolkit before retrying.
- **AGENT CONTEXT:** the fixed line now says that only notes under one `## Archive` heading move.
