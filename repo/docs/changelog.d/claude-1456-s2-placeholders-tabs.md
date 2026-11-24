Title: env edit keeps your typing: placeholders, notes in the file and one tab

### Changed

- An empty `NAME=` line in `toolkit env edit` is a placeholder: it is skipped (nothing stored, a stored value kept), the other lines are applied, and the next tab shows it again. It no longer refuses the whole save.
- The edit file says what happened to a refused save, or one that skipped an empty line: a status line at the top and a note for each line it is about, by line number and key name only.
- Asking for your keys while an edit is open opens that same tab again, applying a waiting save first, instead of replacing it with a new file.

### Fixed

- A save in an older edit tab, such as one an editor brought back, no longer wipes what was typed there. The tab is kept with its editor copies, says it was not saved and which lines differ, and is deleted at the first "done" after a command has shown it. The 30-minute close applies a waiting save first and keeps a tab whose last save was refused.
