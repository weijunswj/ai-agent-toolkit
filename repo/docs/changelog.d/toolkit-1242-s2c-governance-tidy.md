Title: one way to turn governance off, and setup asks nothing when every setting is set

### Changed

- `setup toolkit` in Claude Code asks nothing when every setting already has a value: it shows the tables, keeps every row and says how to change one (such as `3.5=off`). It no longer asks a question whose yes "changes nothing".
- Turning governance off has one route: the card's No, `disable` in your own terminal and the bank's Turn off make the same one pull request. The terminal `disable` is the answer itself and no longer asks a second Enter.
- Where the governance bank is the turn-on question (no card came first), it also takes a plain yes (all recommended), later (no store) or no (the off pull request).
- The governance question in text form names this repository's own store (`TRANSPORT-<name>`) instead of a placeholder.
- The `migrate` question says that only rulesets and branch protection wait for the answer; the free dependency and security settings are turned on either way.

### Fixed

- After an answer the governance bank used, a bare "ok" is told the answer was used, instead of "was not read ... Reply again", and the next reply is no longer framed as answering a bank still open.
- `store=` naming the task repository itself is refused for that reason before anything is made; before, a parent issue was made first and the refusal named the wrong cause.
- Turning governance back on from off gives the governance App line, as a first turn-on does.
- `toolkit governance status` no longer prints "Without hooks ..." while Claude Code or Codex runs Toolkit's hooks; the synced Projects line no longer counts.
- The unread governance bank names a cause that a retry cannot fix (such as a redirected remote), and a read-only `explain` on an unread binding no longer says an answer was not used.
- `status` names a refresh held because the origin could not be read.
