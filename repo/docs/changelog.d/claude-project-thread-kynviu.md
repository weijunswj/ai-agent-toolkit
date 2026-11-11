Title: Merge by card in Claude Code

### Added

- In Claude Code on this computer, a tap can replace typed `merge N`. When the merge hold refuses a merge that names its full head SHA, it hands back one exact card: "Merge owner/name#N at <short SHA>?" with Merge and Not now. The owner's tap on Merge approves that pull request at that commit, once. Not now approves nothing and withdraws an unused approval for it.
- The card counts only in a chat the owner started, shown exactly as given, as a plain tap. A changed card, a card asked with its answer filled in, words typed into Other, an answer the host marks as idle, a follow-up, typed text or noted, an answer with a field the reader does not know, and a launched, resumed or unmarked session record nothing. Nothing is refused for the card's sake, so ordinary questions are untouched.
- A card event fed from a session's own shell records nothing: the host's hook process carries no `TOOLKIT_HOST_SESSION`, so any card event that does is set aside. Commands that feed the hook scripts a tool event (`PreToolUse`, `PostToolUse` or the card functions) are refused like a fed prompt.
- Known limit: a host that answers the card itself, with no tap, is not told apart. That covers a permission answer from an SDK callback, another plugin's permission hook, a permission-prompt tool or a launcher, a reply a connected client sends to a background session, and an automatic answer the host does not mark.

### Changed

- The order for a merge that needs the owner is now: task auto-merge when it applies, then the card, then typed `merge N`. Codex keeps typed `merge N`. Cloud sessions run no hook, so a Projects card there still rests on the written rules and required CI.
- Hook pack rows may use a placeholder in an object key, so a card answer can be keyed by its question.
