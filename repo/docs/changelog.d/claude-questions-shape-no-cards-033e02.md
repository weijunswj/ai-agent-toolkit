### Changed

- Every reply asks its questions the same way: the global rules now say questions go last, each a numbered, fully bold question with lettered choices (A., B.) nested under it, best first, each with a short reason, the recommended one marked (my pick), and a blank line between questions. This replaces the old rule to ask with a question card.
- Toolkit no longer tells agents to open a question card. Whether a question shows as a card, the Claude desktop app's end-of-turn box or plain text is the app's own choice. The desktop asking line keeps only the part that stops context being lost: put the context, the options and your pick in the closing message. The step that started a short background wait to open a card on the next turn is gone.
- The Claude Projects skill drops the question layout the global rules now cover and keeps only its own extras: the `Question:` label, a link to the card or thread on each ask, the problem, fix and skip lines under it, and asking each question once. Standing permission asks, base clash reports and approvals in Projects are asked as questions rather than decision cards.
- Toolkit's own merge card is unchanged: it is still how the merge hold takes the owner's approval.

### Removed

- Claude Code setup no longer has a row for the Claude desktop app's "Archive sessions when their PR closes" setting, and the `--claude-app-setting` option is gone. Toolkit never asks about or recommends that setting: with it on, the app archives the chat that opened a pull request once it merges, which would close a controller chat that binds merge-train pull requests. Archiving finished sessions stays the controller's job. The setup question for the Claude Code settings now counts only the four Claude Code settings.
