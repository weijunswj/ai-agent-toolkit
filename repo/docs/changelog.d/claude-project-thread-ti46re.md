Title: governance question bank

### Changed

- `toolkit governance`, `setup governance` and `refresh governance` now show a question bank in the same format as `setup toolkit`: GitHub governance on or off, task auto-merge on or off, and Toolkit's permission blocks, each with at most three lettered choices and `A. Keep current` first, plus the evidence store and required checks as status lines. The owner replies `all recommended` or only their changes, such as `1.2=B`, in chat. Turning governance on or off no longer needs the owner's own terminal.
- Only the owner answers the bank: the prompt hook gives the owner's next own message after the bank a one-use ticket bound to the session, its run, the repository and the bank shown, and the bank acts only with that ticket. A launched session, a relayed or scheduled prompt, a repeated Projects delivery, another session or a changed bank gets none. Every change is still one pull request the owner merges.
- Picking "Add them for me" on the permission row is the owner's own ask for the agent to add the printed blocks (backed up first and read back); "Show me the command" prints them with the one command the owner pastes.
- The question bank format (table, choice letters, Keep current folding, bank reference and reply reading) now lives in one shared module used by both setup and governance; setup's output is unchanged.

### Removed

- `refresh governance --set on|off` and the terminal-only `setup governance` questions; the bank replaces both.
