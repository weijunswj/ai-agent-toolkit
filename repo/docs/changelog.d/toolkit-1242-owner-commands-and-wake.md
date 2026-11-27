### Fixed

- The `remove toolkit` plan no longer puts the permissions command inside a list line. Its Kept line says the lines are removed by your own command below the plan, and the command comes once, after the lists, in its own PowerShell block.
- `review permissions` shows each of your own lines in plain words only, such as "Runs a Python script" or "Any GitHub call, merges and deletes included", never the command itself; the raw line, with any key hidden, comes only when you say show all.
- In the Claude desktop app, a question with three or more choices now gets its card: the asking line has the agent start one short background wait (about 30 seconds) right before it ends the turn with the context, then open the card first, with no text, on the automatic turn the wait brings.
