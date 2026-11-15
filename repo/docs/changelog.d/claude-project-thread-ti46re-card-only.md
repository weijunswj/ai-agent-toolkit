### Fixed

- In Claude Code, `toolkit governance` now shows the owner only the question card. The prompt hook used to tell the agent to show the setup output in full, so the agent's own instructions and the card's input reached the owner's screen as text and no card appeared. The hook now tells the agent to follow the bank's `Agents` paragraph and never show it, and the bank keeps every agent-only line in that last paragraph.
