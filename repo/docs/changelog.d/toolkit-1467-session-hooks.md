### Added

- **How to ask the owner, in the Claude desktop app:** each session start (startup, resume, clear, compact) ends with one line for the agent, in every folder and whatever the governance state: the context, options and pick go in the closing message and the question card follows on the next turn, because the app cuts text written before a card in the same turn. It stands over the agent's own notes, no card is refused and Toolkit's merge card keeps its own text. The terminal, the IDE extensions, cloud sessions and Codex do not get it.
- **Woken for each finished gate:** the note after a gate launch (Claude Code) says to watch GitHub for each running gate session's own result, since the app continues a chat only once none of the sessions it started is working.

### Fixed

- The turn-end owed check no longer lists work that is already recorded. `programme.cjs gate-session` keeps its accepted result on this computer and the check reads that instead of the words of shell commands, so a record made through a script or a variable counts, and a refused one does not. The first turn end after the update may list gates launched in the last day and recorded by the older version; the same `gate-session` command answers `NOOP` and clears each.
- The owed check no longer lists a gate session held at its first turn (`First turn: reply only READY`) before its go-ahead.
- The owed check's stop text asks only for what was done, and not to repeat the last message or its question.
- A copy of a controller's chat that was itself rewound no longer counts as the controller while the original goes on.

### Changed

- The global question rule says a question card holds only the question.
