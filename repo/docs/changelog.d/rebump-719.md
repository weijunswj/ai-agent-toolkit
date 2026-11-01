Title: keys open in your .env editor

### Changed

- `toolkit env edit` opens the key file in the app this computer uses for `.env` files, through the Windows shell by full path, instead of always in Notepad. VS Code, VS Code Insiders, VSCodium and Cursor start by their own path in a new window with no folder, so workspace extensions and IDE links to agents do not attach to it.
- A deleted line no longer removes its key within seconds. It is marked (shown in the file's status line and in `status`), and "done" asks one yes/no that names every marked key before removing any; a no, no answer, a new edit or the 30-minute end keeps them. Putting the line back cancels it.
- Every end of an edit removes the copies VS Code-style editors keep of Toolkit's own edit files (Local History and hot-exit backups), overwriting each with zeros first, and says how many. The closing note is worded for the app the file opened in, and the file's header warns that extensions can read an open tab.
- The test guard that blocks Notepad launches also refuses opening an edit file in the shell or an editor, and is renamed to match.
