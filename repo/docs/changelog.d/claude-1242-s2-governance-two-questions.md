Title: Governance asks two questions

### Changed

- The governance question bank now asks at most two questions: GitHub governance (on or off) and task auto-merge. Everything else is a Toolkit default shown as a status line under the table, which any answer applies: parallel CI shards when the last green CI run took 10 minutes or more (none for faster or unknown CI, and none where CI already runs its tests in parallel), the governance App and Toolkit permissions commands when they are needed, and the instruction copies cleanup while governance stays on. Merge trains are no longer asked; turning governance on writes them off, and a governed repository keeps its stored value.
- Where governance is not decided yet, the answer itself turns it on, so the governance row is a status line and only task auto-merge is asked. Reply `no store` to keep governance off: nothing is written and Toolkit asks again next session.
- Add `shards=yes`, `shards=not-now` or `shards=never` to a reply to change the shards default, and `store=<owner/name>` to use another private repository of yours as the evidence store.
- Turning governance on uses this repository's own private `TRANSPORT-<repository name>` store, found or created, and never another repository's store unless you name it. The session-start question and the turn-on result name the store.
- `toolkit governance migrate` asks one Enter for all of its GitHub changes (the no-force-push ruleset, the programme-state ruleset and default-branch protection) instead of one each, and a no writes none of them.
- An answer to a bank whose status lines changed since it was shown is refused, so an answer never applies a default you did not see.

### Fixed

- A finish mark whose governance turn-on pull request was closed without merging is cleared instead of waiting for ever.
- The bank heading says "1 question across 1 section" instead of "1 questions across 1 sections".
- The Claude Code setup question says how many settings a yes would set, so it reads on its own on a question card.
- A piped setup reply with a second non-empty line is refused before anything is written.
- A no to the Claude Code setup question says when setup had already updated the Toolkit checkout before asking.
- Setup reads the AGENTS.md memory setting under either plugin name, writes the older name when it cannot tell the Claude Code version, and keeps a value you set under the other name.
