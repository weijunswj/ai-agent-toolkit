Title: fewer setup re-asks, and Antigravity in Claude Code setup

### Changed

- **Codex hooks no longer void setup answers:** The "Toolkit hooks in Codex" status line takes no answer, and setup never changes it, so its state is no longer bound into the setup bank reference. Turning the hooks on in Codex's `/hooks` while the table is open keeps the same bank, and your answer still applies.
- **Antigravity in Claude Code setup:** Claude Code setup now offers "Copy Toolkit's skills into Antigravity?" too, whenever Antigravity is on the computer, as Codex setup already did. It is one folder on the computer, whichever app sets it up, so a removal run from Claude Code can be undone from Claude Code.
