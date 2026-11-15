### Fixed

- When Task Scheduler fails, `remove toolkit` now names the error inside its "could not be planned; nothing was removed" line, screened for anything secret-shaped, so a denial says what was denied. The message is PowerShell's first real error line, past the progress block Windows PowerShell can write first, which also makes a failed removal's reason readable.
- Setup's line about old Toolkit tasks now says plainly that `remove toolkit` uninstalls Toolkit from the computer after your OK, and that the old tasks go with it only once no app keeps Toolkit. The setup skill says the same.
- The 3.132.0 notes now say what an old Toolkit task really does when it fires: it finds its runner gone and exits with an error, then turns itself off after three such runs if Toolkit's record still matches it.

### Changed

- The old Windows task cleaner now has a fixed end: it goes in the first Toolkit release on or after 1 March 2027.
- Tests now cover the task record's own guards (secret screening, the file's mode, path and stop-time checks, and the refusal to rewrite a record it could not read), and a hand edit made only in a task's exported XML, which is planned as changed and kept.
