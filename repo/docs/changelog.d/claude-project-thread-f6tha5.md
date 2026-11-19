### Fixed

- **Explain needs no ticket:** `explain 1.4` in reply to the governance question bank now only prints that row, before or after an answer. It needs no reply ticket, spends none and writes nothing, so the bank stays open for the owner's answer. Every other bank reply still needs the owner's one-use ticket, and the tool gate still refuses one without it.
- **The bank stays open after an answer:** the owner's next own message after an answer gets a new one-use ticket for the same bank, so a further change or a row that does not exist (`1.9=A`) gets its own line ("This bank has no row 1.9.") instead of a note about a used ticket.
