### Added

- In Claude Code, a question card is refused when the agent already wrote text earlier in the same turn, since the desktop app shows only the open card and hides that text, and when a card's question is longer than 120 characters. The refusal tells the agent to ask in its closing message instead, or to put the context into the card's option descriptions. Toolkit's own governance and merge cards are not affected, and a card is shown with a note when the session's transcript cannot be read.
