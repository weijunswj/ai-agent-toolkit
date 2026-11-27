Title: guided governance setup

### Added

- `toolkit governance` in a repository that is not governed asks three short questions in one message, each part explained first and the questions last in the global question shape: turn governance on (yes, later or no), the evidence store (this repository's own private store, another private repository, or no store) and task auto-merge with merge train (yes or no). Answer in your own words or with the letters, such as `1A 2A 3A`.
- Where governance is on, `toolkit governance` shows one summary: the steps still left with their commands in PowerShell blocks (Toolkit permissions first, counting your own lines without listing them, then the Governance App), then one table of every part with its state and what it does. Changes are said in words: turn off governance, task auto-merge on or off, change store, or `shards=` for parallel CI shards.
- A tap on a question card the app chose to show counts as your reply to Toolkit's governance questions, the same way a typed reply does.
- After your answer the agent carries the setup through in the same turn: it waits for the setup pull request's checks, merges it only through your approval on the merge card, runs the post-merge finish and shows the summary.

### Changed

- Toolkit no longer forces a question card or a background wait for the governance questions: how they show (text, a card or the end-of-turn box) is the app's choice. Toolkit's merge card is unchanged.
- The setup pull request writes `min_toolkit` with this Toolkit's version (which turns on the setup hold) and, when you answer yes to task auto-merge, merge trains on with it.
- The old governance question bank (its table of codes such as `1.2=B` and the `explain` command) is retired.
