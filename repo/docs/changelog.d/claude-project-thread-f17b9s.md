Title: your keys in Notepad, with every save kept

### toolkit env

- **Changed:** `toolkit env edit` opens your keys in Notepad as `NAME=value` lines with their real values, like a `.env` file, in your saved order with your comment lines. Change a value, add a line, or delete a line to remove that key, then save: a small helper started with the file applies each save within a few seconds. Saying "done" (or `apply`) applies a save not applied yet, deletes the file and lists what was changed, added and removed, by name only. Deleting a line no longer needs a separate `remove`.
- **Safer saves:** a save is applied whole or not at all. Nothing is saved, and a `# Status:` line at the top of the file says why, for an unreadable line, a blank value, a key name used twice, a quoted value, a UTF-16 save, a save that would remove every key, or keys changed elsewhere while the tab was open. A key added elsewhere during the edit is never removed. A value one line cannot show exactly appears as `<kept: change it with toolkit env set NAME>` and stays as it is.
- **Fixed:** a second edit reused an open edit file younger than 30 minutes without refreshing it, so it could show a key you had removed. Every edit now writes a fresh file from the store and wipes the earlier one; a save from an older Notepad tab is ignored and wiped, and the result says to use the newest tab. Edit files of earlier versions are wiped, never applied.
- **New:** every "done" says to close the Notepad tab without saving, because Notepad can keep its own copy of an open tab and bring it back, and how to stop that for good ("Start new session"). The file is deleted 30 minutes after its last save if "done" never comes.

### Skill

- The `toolkit-env` skill opens Notepad whenever you want to see or change your keys, in any words, keeps `status` for names-only questions, and tells agents never to open, read or search the edit file.
