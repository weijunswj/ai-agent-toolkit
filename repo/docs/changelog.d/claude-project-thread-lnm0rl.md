Title: governance question without the freeze

### Changed

- **The governance question no longer freezes a repository:** a github.com repository with no merged decision now counts as off. Work carries on under the global rules, Toolkit asks yes, no or later once per session, and no message or tool waits on the answer. The first message of a session goes through with the question (a card in Claude Code, text at the end of the reply in Codex) and Toolkit asks again next session until a decision is merged.
- **Answering:** `toolkit governance enable` or `toolkit governance disable`, sent as the whole message, is recorded at any point in a session that was asked. Any other reply, a bare `yes` or `no` included, now goes through the agent with a one-use reply ticket on your next message after the question, because without a hold a bare `yes` may be answering something else. A card tap is recorded as before.
- **Typed commands:** a typed Toolkit command now gets its line on every message except the one that carries the question.
- **Kept refusals:** an agent still cannot run the governance CLI with a decision, edit Toolkit's user-state files, show Toolkit's card with an answer filled in, schedule a prompt for itself while your reply is awaited, or run the answer script in any form other than the exact command given with your reply. Automation sessions are never asked and cannot answer. A hook that fails still holds inside a repository, as before.

### Removed

- **Held messages:** nothing is stored or replayed. The file of messages an earlier version held is deleted at session start.
- **Tool holds for the question:** the refusal of every tool in an undecided repository, of commands that reach into one from another folder, and the scheduled-task exception that existed only to pass that hold.
