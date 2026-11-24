### Fixed

- **Merge card after a PC restart:** the owner's Claude Code chat, reopened by the app, keeps its merge card however many other sessions started on this computer meanwhile. Toolkit now keeps each session's start record for 30 days after the chat last started or was reopened (up to 4,096 records) instead of only the newest 256, and a compaction or clear no longer overwrites a record it briefly cannot read.
- **Exact reason when it cannot:** if any start of the chat found its start record missing or unreadable, the merge refusal and the typed-line note say so once the app reopens it, and name where to approve (a new chat on this computer, a direct Projects message, or the Merge button on GitHub). Before that, the standing task auto-merge note already warns.
