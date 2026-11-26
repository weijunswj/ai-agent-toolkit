Title: remove toolkit shows a plain plan and leaves a clean folder

### Changed

- `remove toolkit` shows its plan and closing lines in the house format: a From line, then **Removed**, **Kept** and **Never touched**, each line a bold label with short paths. Lists longer than three fold into a count with the full list on request (`plan --full`). The plugin uninstall lines and the apply line with the plan code sit below an agent-only line, and the setup skill says to show the rest as ordinary text, never in a code block.
- Only true lines: a Kept or warning line appears only when it is found and true for this removal. No Task Scheduler line on a system without one, no "run plan with --app all" line, and an MCP server is named only when this removal deletes the Toolkit folder entry its key helper runs from.
- A full removal (or the last app's) now deletes everything Toolkit made in `~/.ai-agent-toolkit`, its records, locks, staging leftovers and older backups included. It keeps only the key list (`env`), the recovery records (`recovery-identities`) and this removal's backup, gathered in `backups/remove-toolkit`; anything that is not Toolkit's stays and is listed.
- After the removal, the closing lines name each MCP server that lost its key helper and say how to connect it again: give it its key another way, or say `setup toolkit` and then `toolkit env`. Its settings and key are not touched.

### Fixed

- The leftover scan and the instruction cleanup read `@AGENTS.md` only outside fenced code, as Claude Code does, through one reader shared with the bridge; the cleanup removes every listed block in a CLAUDE.md in the same run as its shim replacement.
