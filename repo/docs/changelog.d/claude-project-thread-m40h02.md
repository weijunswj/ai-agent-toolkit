Title: Claude Code settings on and off

### Changed

- The four Claude Code setting rows in setup now offer Turn on, Turn off and Keep current, and their titles read "Claude Code setting: <name>?".
- Turn off removes that one setting from the Claude Code user settings file whoever added it, including the full attribution object form. Parent objects and the file itself are removed only when they end up empty and setup created them; the other settings are never touched.
- Turn on sets Toolkit's value, replacing a different value already in the settings file. A value that already does what Toolkit's does is left as it is.
- The Current column says where a value came from in plain words: On (added by setup), On (already in your settings), Different value in your settings, or Off (Claude Code default).
- A setting whose parent entry is not an object is held unchanged on Turn on and Turn off, and the row says why.
