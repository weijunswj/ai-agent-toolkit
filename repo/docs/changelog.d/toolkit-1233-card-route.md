Title: question cards after the full message

### Changed

- **Question cards in Claude Code:** the refusal of a card after text in the same turn, and of a question over 120 characters, now names the route: the full context in the turn's closing message, a short background command (about 20 seconds) started before the turn ends, then the card first on the wake with no text. What is refused is unchanged.
- **The merge card says what it does:** its Merge option now reads "Merges pull request N of owner/name into its base branch, at commit <full SHA>. Nothing else is approved." Toolkit builds the line from the merge it refused and reads no pull request title for it, so no one else's text reaches the card. Any other wording, pull request or repository records nothing.
- **The merge refusal names the route too:** the effects summary goes in the closing message and the card opens the next turn.
- **Merge train `land`, route owner:** the merge guard's card is the one ask, under the effects in the closing message. The agent asks first only where no guard is known to run, or where task auto-merge is on and the guard may let the merge through unasked.
- **Asking rules:** the controller page, the takeover, safety-gates and pull request review playbooks and the host contract say the same; where the host cannot wake the session, the question ends the closing message.
