Title: Merge by card in Claude Code

### Added

- In Claude Code on this computer, a tap can replace typed `merge N`. When the merge hold refuses a merge that names its full head SHA, it hands back one exact card: "Merge owner/name#N at <short SHA>?" with Merge and Not now. The owner's tap on Merge approves that pull request at that commit, once. Not now approves nothing and withdraws an unused approval for it.
- The card counts only in a chat the owner started, shown exactly as given. A changed card, a filled-in answer, words typed into Other, and a launched, resumed or unmarked session record nothing. Nothing is refused for the card's sake, so ordinary questions are untouched.

### Changed

- The order for a merge that needs the owner is now: task auto-merge when it applies, then the card, then typed `merge N`. Codex keeps typed `merge N`. Cloud sessions run no hook, so a Projects card there still rests on the written rules and required CI.
- Hook pack rows may use a placeholder in an object key, so a card answer can be keyed by its question.
