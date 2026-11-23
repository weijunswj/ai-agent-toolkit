Title: merge approvals in a reopened chat
### Added

- **Reopened chats approve merges:** in Claude Code on this computer, a chat the user started and the app later reopened on the same session takes a typed `merge N` and a tap on the merge card again, as a fresh chat does. Launched, forked and shell-resumed chats, a resume that carried the host-session variable, Codex or unknown-app reconnects and resumed cloud sessions still record nothing. The host now comes from the hook entry point, never from a field in the event.
- **No planted merge lines:** a session brief, a message to another session, a move to the cloud, a scheduled wakeup, a cron prompt, a remote routine or a scheduled task whose text holds a line Toolkit would read as the user's merge approval is refused, so an agent cannot approve a merge by writing the user's line into another chat. A side chat the user opens and types into still counts as theirs.

### Changed

- **Honest refusals:** when a chat cannot record a typed merge approval, the hook says so on the message that held it, with the reason and where to approve instead (a new chat, a direct Projects message or the Merge button on GitHub), and the merge refusal in that chat no longer asks the user to type the line again there.
