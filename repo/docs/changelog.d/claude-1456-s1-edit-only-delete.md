Title: env edit file is the only way to delete a key

### Changed

- `toolkit env edit` now applies each save exactly: a changed value is replaced, a new line is added and a deleted line removes its key on that save, with no question at "done". The file's `# Status:` line says which keys were removed, and "done" names any app entry that used one. A save that would remove every key is still refused; it now says to delete the last keys by hand in Windows Credential Manager.

### Removed

- `toolkit env remove NAME`. The edit file is the only way Toolkit deletes a key; no other command, and nothing else in Toolkit (setup, refresh, `remove toolkit`), deletes one. An edit opened by an earlier version that only marked deleted lines is applied from the file at "done".

### Fixed

- Tests can no longer reach the real key store: in a test run the store refuses the real `ai-agent-toolkit/env/` prefix before Windows PowerShell starts.
